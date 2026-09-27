import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { schoolHandoutFixture } from "@/test-support/school-handout-fixtures";
import { reviewedHash } from "@/test-support/reviewed-exam-fixtures";

type Obj = Record<string, unknown>;
const without = (o: Obj, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const official = "https://media.merriam-webster.com/audio/prons/en/us/mp3/f/fakeword_1.mp3";
describe.sequential("exact approved audio corrections", () => {
  let db: PGlite;
  const identities = [1, 2].map(n => {
    const request = reviewedHash("fake-audio-" + n);
    const i = { ...schoolHandoutFixture().old.voice.identities[0]!, headword: "fakeword", headword_normalized: "fakeword", lexical_pos: "adverb",
      identity_id: "pron:v3:" + reviewedHash("fake-identity-" + n), pronunciation_variant_id: "synthetic:" + request,
      audio_provider: "google_cloud_text_to_speech", official_audio_url: null, sound_audio: null, mw_notation: null,
      storage_bucket: "vocab-pronunciation-audio", storage_object_key: "pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/" + request + ".mp3",
      audio_sha256: reviewedHash("fake-bytes-" + n), byte_count: 1500, profile_id: "profile:1a77d56d47e26013",
      request_sha256: request, model: "chirp3-hd", voice: "en-US-Chirp3-HD-Despina", identity_content_sha256: "" };
    i.identity_content_sha256 = reviewedHash(without(i, "identity_content_sha256")).toUpperCase(); return i;
  });
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    for (const i of identities) {
      const asset = { ...Object.fromEntries(["request_sha256", "audio_sha256", "byte_count", "storage_bucket", "storage_object_key", "profile_id", "model", "voice"].map(k => [k, (i as Obj)[k]])), storage_verified: true };
      await db.query("select private.register_vocab_pronunciation_tts_asset_batch_v2($1)", [JSON.stringify([asset])]);
      await db.query("insert into public.vocab_pronunciation_identities_v2 select x.* from jsonb_populate_record(null::public.vocab_pronunciation_identities_v2,$1::jsonb||jsonb_build_object('imported_at',now())) x", [JSON.stringify(i)]);
    }
  }, 60_000);
  afterAll(async () => { await db?.close(); });
  async function approve(n = 0, overrides: Obj = {}) {
    const i = identities[n]!;
    const c = { correction_id: "fake-" + n, prior_identity_id: i.identity_id, prior_identity_sha256: i.identity_content_sha256,
      headword: i.headword, lexical_pos: i.lexical_pos, locale: "en-US",
      replacement_variant_id: "mw:" + "a".repeat(20), replacement_sound_audio: "fakeword_1", replacement_audio_url: official,
      raw_source_sha256: "b".repeat(64), source_locator: "fake test only", review_sha256: "c".repeat(64), approval_reason: "fake test", enabled: true, ...overrides };
    await db.query("insert into private.pronunciation_audio_corrections_v1 select x.* from jsonb_populate_record(null::private.pronunciation_audio_corrections_v1,$1::jsonb||jsonb_build_object('created_at',now())) x", [JSON.stringify(c)]);
  }
  const read = () => db.query<{ replacement_audio_url: string }>("select * from public.list_pronunciation_audio_corrections_v1()");
  const originals = async () => JSON.stringify((await db.query("select * from public.vocab_pronunciation_identities_v2 order by identity_id")).rows);
  it("selects both exact old assets, preserves originals and supports disabling the correction", async () => {
    const before = await originals(); await db.exec("begin");
    try {
      await approve(0); await approve(1);
      const rows = (await read()).rows;
      expect(rows).toHaveLength(2);
      expect(rows.every(row => row.replacement_audio_url === official)).toBe(true);
      expect(await originals()).toBe(before);
      await db.exec("update private.pronunciation_audio_corrections_v1 set enabled=false");
      expect((await read()).rows).toEqual([]);
    } finally { await db.exec("rollback"); }
  });
  it.each([{ headword: "different" }, { lexical_pos: "noun" }, { prior_identity_sha256: "0".repeat(64) }, { enabled: false }])("does not activate mismatched proof %j", async change => {
    await db.exec("begin"); try { await approve(0, change); expect((await read()).rows).toEqual([]); } finally { await db.exec("rollback"); }
  });
  it.each(["anon", "authenticated", "service_role"])("blocks direct data access for %s", async role => {
    await db.exec("begin"); try {
      await db.exec("set local role " + role);
      await expect(db.query("select * from private.pronunciation_audio_corrections_v1")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("rollback"); }
  });
  it.each(["anon", "authenticated"])("blocks correction RPC for %s", async role => {
    await db.exec("begin"); try { await db.exec("set local role " + role); await expect(read()).rejects.toThrow(/permission denied/); }
    finally { await db.exec("rollback"); }
  });
  it("allows the service read, not edits to immutable proof", async () => {
    await db.exec("begin"); try { await approve(); await db.exec("set local role service_role"); expect((await read()).rows).toHaveLength(1); }
    finally { await db.exec("rollback"); }
    await db.exec("begin"); try { await approve(); await expect(db.exec("update private.pronunciation_audio_corrections_v1 set headword='different'")).rejects.toThrow(/immutable/); }
    finally { await db.exec("rollback"); }
  });
  it("rejects a second approval and non-official replacement URL", async () => {
    for (const change of [{ correction_id: "second" }, { replacement_audio_url: "https://evil.test/fakeword_1.mp3" }]) {
      await db.exec("begin"); try { await approve(); await expect(approve(0, change)).rejects.toThrow(); } finally { await db.exec("rollback"); }
    }
  });
});

