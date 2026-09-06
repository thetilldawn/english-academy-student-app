import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishObjects } from "../../../scripts/publish-vocab-pronunciation-audio-v2";
import { schoolPronunciationFixture } from "@/test-support/pronunciation-fixtures";
import { SCHOOL_PRONUNCIATION_SCOPES, validateSchoolPronunciationRelease } from "./school-pronunciation-release-contract";
import { computeVocabPronunciationPackageVersion, validateVocabPronunciationReleaseV2 } from "./vocab-pronunciation-release-v2-contract";

describe("approved school pronunciation scopes", () => {
  it.each(SCHOOL_PRONUNCIATION_SCOPES.map((s, i) => [s.datasetKey, i] as const))("accepts complete %s", (_, index) => {
    expect(validateSchoolPronunciationRelease(schoolPronunciationFixture(index)).summary.binding_count).toBe(SCHOOL_PRONUNCIATION_SCOPES[index].entryCount);
  });
  it("does not make the legacy VOCA importer accept school data", () => {
    expect(() => validateVocabPronunciationReleaseV2(schoolPronunciationFixture())).toThrow();
  });
  it("publishes an official-only package as a no-op without remote credentials", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "school-audio-noop-"));
    try {
      const release = schoolPronunciationFixture();
      const manifest: Record<string, unknown> = { schema_version: "google-chirp-school-audio-batch-v1",
        status: "complete", dataset_key: release.dataset_key, source_plan_version: release.source_plan_version,
        profile_id: "approved-normal-rate-mixed", profile: { speaking_rate: 1 },
        asset_count: 0, binding_count: 0, total_byte_count: 0, items: [] };
      const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
      const hash = () => createHash("sha256").update(JSON.stringify(canonical(manifest)).replace(/"speaking_rate":1(?=[,}])/g, '"speaking_rate":1.0')).digest("hex");
      manifest.manifest_sha256 = hash();
      release.source_tts_manifest_sha256 = hash().toUpperCase();
      release.package_version = computeVocabPronunciationPackageVersion(release);
      release.release_id = "voca-release:" + release.package_version.toLowerCase();
      writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
      writeFileSync(path.join(directory, "release.json"), JSON.stringify(release));
      const result = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/publish-vocab-pronunciation-audio-v2.ts",
        "--school", "--target", "staging", "--apply", "--env-dir", directory,
        "--manifest", path.join(directory, "manifest.json"), "--release", path.join(directory, "release.json")], {
        encoding: "utf8", timeout: 20_000, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" },
      });
      expect(JSON.parse(result)).toMatchObject({ status: "ok", mode: "apply", noOp: true, assetCount: 0, canary: null });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([false, true])("reads later Storage pages and preserves immutable bytes (changed=%s)", async (changed) => {
    const value = Buffer.from("ID3" + "a".repeat(200));
    const request = "1".repeat(64);
    const fileName = request + ".mp3";
    const file: Parameters<typeof publishObjects>[1][number] = { value, item: {
      candidate_id: "synthetic:" + request, headword: "test", source_rows: [1], request_sha256: request,
      audio_sha256: createHash("sha256").update(value).digest("hex"), byte_count: value.length,
      file_name: fileName, storage_bucket: "vocab-pronunciation-audio", storage_object_key: "approved/" + fileName,
      profile_id: "profile:1a77d56d47e26013", speaking_rate: 1, model: "chirp3-hd", voice: "en-US-Chirp3-HD-Despina",
      pronunciation_variant_id: "synthetic:" + request, playback_enabled: true,
    } };
    const list = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, n) => ({ name: "old" + n })), error: null })
      .mockResolvedValueOnce({ data: [{ name: fileName }], error: null });
    const upload = vi.fn();
    const download = vi.fn().mockResolvedValue({ data: new Blob([changed ? Buffer.from("changed") : value]), error: null });
    const client = { storage: { from: () => ({ list, upload, download }) } } as unknown as SupabaseClient;
    if (changed) await expect(publishObjects(client, [file])).rejects.toThrow("해시 불일치");
    else expect(await publishObjects(client, [file])).toEqual({ uploaded: 0, reused: 1 });
    expect(list).toHaveBeenNthCalledWith(2, "approved", expect.objectContaining({ offset: 1000 }));
    expect(upload).not.toHaveBeenCalled();
  });
  it.each(["dataset", "hash", "count", "hole", "pos", "identity", "display", "package"])("rejects altered %s", (kind) => {
    const r = schoolPronunciationFixture();
    if (kind === "dataset") r.dataset_key = "simseok-unapproved";
    if (kind === "hash") r.dataset_source_sha256 = "F".repeat(64);
    if (kind === "count") r.summary.binding_count--;
    if (kind === "hole") r.bindings[1].source_row = r.bindings[0].source_row;
    if (kind === "pos") r.bindings[0].lexical_pos = "verb";
    if (kind === "identity") r.bindings[0].identity_id = "pron:v3:" + "9".repeat(64);
    if (kind === "display") r.identities[0].display_pronunciation_ko = "";
    if (kind === "package") r.package_version = "F".repeat(64);
    expect(() => validateSchoolPronunciationRelease(r)).toThrow();
  });
});
