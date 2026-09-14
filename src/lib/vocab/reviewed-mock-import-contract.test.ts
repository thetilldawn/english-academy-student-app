import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildReviewedMockFixture, resealMockReview } from "@/test-support/reviewed-mock-wordbook-fixture";
import { assertReviewedMockEnvironment, sealReviewedMockBundle, validateReviewedMockBundle, verifyReviewedMockRawPronunciations } from "./reviewed-mock-import-contract";
import { sha256CanonicalJson } from "./exam-use-import-contract";

describe("reviewed monthly mock source contract", () => {
  it("keeps original POS absent while recording supplemental fields and both independent reviews", () => {
    const { bundle, summary } = validateReviewedMockBundle(buildReviewedMockFixture());
    expect(summary.links).toEqual({ dictionary: 6, pos: 6, pronunciation: 0, definition: 1, example: 1 });
    expect(bundle.resources[0]!.original_pos).toBeNull();
    expect(summary.scopeCount).toBe(2);
  });
  it("rejects two records from the same reviewer even after recomputing the package", () => {
    const bundle = buildReviewedMockFixture();
    bundle.resources[0]!.review_records[1]!.reviewer = "fixture-alpha";
    expect(() => validateReviewedMockBundle(sealReviewedMockBundle(bundle))).toThrow("독립 검토");
  });
  it("rejects a changed resource value that both reviews have not seen", () => {
    const bundle = buildReviewedMockFixture();
    bundle.resources[0]!.definition.value = "Changed after review.";
    expect(() => validateReviewedMockBundle(sealReviewedMockBundle(bundle))).toThrow("독립 검토");
  });
  it("keeps repeated source content in separate question occurrences with unique storage keys", () => {
    const bundle = buildReviewedMockFixture();
    bundle.package.entries[3]!.entry_row_sha256 = bundle.package.entries[0]!.entry_row_sha256;
    expect(() => validateReviewedMockBundle(resealMockReview(bundle))).toThrow("저장 식별값");
    for (const entry of bundle.package.entries) {
      entry.entry_row_sha256 = sha256CanonicalJson({
        source_entry_id: entry.source_entry_id,
        source_entry_sha256: entry.source_entry_sha256,
      }).toUpperCase();
    }
    expect(validateReviewedMockBundle(resealMockReview(bundle)).bundle.package.entries).toHaveLength(6);
    expect(new Set(bundle.package.entries.map(entry => entry.source_entry_sha256)).size).toBe(1);
  });
  it("rejects missing source rows and an inconsistent year or long-reading scope", () => {
    const missing = buildReviewedMockFixture(); missing.resources.pop();
    expect(() => validateReviewedMockBundle(sealReviewedMockBundle(missing))).toThrow("연결 수");
    const wrongYear = buildReviewedMockFixture(); wrongYear.scopes[0]!.metadata.executionYear = 2024;
    expect(() => validateReviewedMockBundle(sealReviewedMockBundle(wrongYear))).toThrow("연도·월");
    const wrongScope = buildReviewedMockFixture(); wrongScope.scopes[0]!.metadata.questionNumbers = [41, 42, 43];
    expect(() => validateReviewedMockBundle(sealReviewedMockBundle(wrongScope))).toThrow("공유지문");
  });
  it("requires correction evidence before changing the supplied Korean meaning", () => {
    const bundle = buildReviewedMockFixture(); bundle.package.entries[0]!.display_gloss_ko = "달라진 뜻";
    expect(() => validateReviewedMockBundle(resealMockReview(bundle))).toThrow("교정 근거");
  });
  it("requires an explicit matching known environment", () => {
    expect(assertReviewedMockEnvironment("https://wojxpruvbjzbhrpmsbuy.supabase.co", "wojxpruvbjzbhrpmsbuy")).toBe("wojxpruvbjzbhrpmsbuy");
    expect(() => assertReviewedMockEnvironment("https://xdxhswjgksukjmpbzqgz.supabase.co", "wojxpruvbjzbhrpmsbuy")).toThrow("대상");
  });
  it("binds the selected audio to the actual original entry and its evidence", async () => {
    const bundle = buildReviewedMockFixture();
    const raw = JSON.stringify([{ meta: { id: "fixture1" }, fl: "noun", hwi: { hw: "fixture1", prs: [{ mw: "fake", sound: { audio: "fixture01" } }] } }]);
    const rawHash = createHash("sha256").update(raw).digest("hex");
    const variantId = `mw:${sha256CanonicalJson({ entry_index: 0, meta_id: "fixture1", pos: "noun", pronunciation_index: 0, mw_notation: "fake", sound_audio: "fixture01" }).slice(0, 20)}`;
    const value = { variant_id: variantId, variant_pos: "noun", notation: "fake", sound_audio: "fixture01", audio_url: "https://media.merriam-webster.com/audio/prons/en/us/mp3/f/fixture01.mp3", raw_sha256: rawHash };
    const evidence = { source: "preserved_raw" as const, path: "fake-raw.json", locator: "payload[0] meta.id=fixture1 hwi.prs[0]", sha256: rawHash };
    const entry = bundle.package.entries[0]!;
    entry.pronunciation_variant_id = variantId;
    entry.audio = { status: "raw_attached", audio_url: value.audio_url, sound_audio: value.sound_audio, raw_response_sha256: rawHash,
      raw_source: "preserved_webster_collegiate", raw_relative_path: evidence.path, source_locator: evidence.locator, reason: null,
      selection_status: "reviewed_exact_headword_single_pos", variant_id: variantId, variant_pos: "noun", mw_notation: "fake" };
    bundle.resources[0]!.pronunciation = { status: "linked", value, evidence: [evidence], reason: "가짜 원문 검증" };
    resealMockReview(bundle);
    expect(validateReviewedMockBundle(bundle).summary.links.pronunciation).toBe(1);
    await expect(verifyReviewedMockRawPronunciations(bundle, async () => raw)).resolves.toBeUndefined();
    entry.audio.raw_relative_path = "unlisted-raw.json";
    expect(() => validateReviewedMockBundle(resealMockReview(bundle))).toThrow("원문 근거");
    entry.audio.raw_relative_path = evidence.path;
    entry.audio.mw_notation = "changed";
    bundle.resources[0]!.pronunciation.value!.notation = "changed";
    resealMockReview(bundle);
    await expect(verifyReviewedMockRawPronunciations(bundle, async () => raw)).rejects.toThrow("원표제어");
  });
});
