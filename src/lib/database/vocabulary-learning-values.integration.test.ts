import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { libraryResourceSchema, learningPronunciationSchema } from "@/features/wordbook-compositions/contracts/library-resources";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const entry = {
  id: 987654321, dataset_id: randomUUID(), unit_id: randomUUID(), source_row: 1, row_sha256: sha("fake-row").toUpperCase(), source_ref: "fake/book#1",
  headword: "Fake", headword_normalized: "fake", primary_meaning: "  가짜 뜻  ", meanings: ["  가짜 뜻  ", null, "두 번째 뜻"], pronunciation_ko: "원래 표기",
  english_definition: "Entry definition.", example_en: "Entry example.", example_ko: "원래 예문.", entry_type: "word", import_metadata: { rawBody: "Original-only fake metadata." },
};
const source = { kind: "legacy_vocab", datasetId: entry.dataset_id, unitId: entry.unit_id, releaseId: null as string | null, version: sha("version"), fileHash: sha("file"), locator: "fake.json",
  sourceRow: 1, occurrenceKey: sha("occurrence"), state: "included" };
const selected = {
  schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: { headword: "Original source body.", meaning: "Original meaning body." },
  pronunciation: { displayKo: "선택발음", variantId: "fake:pron:1", audioUrl: "https://media.merriam-webster.com/audio/prons/en/us/mp3/f/fake001.mp3", available: true,
    segments: [{ text: "선택", stress: "primary" }, { text: "발음", stress: "none" }] },
  lexicalPos: "noun", dictionary: { dictionary_id: "word:fake", legacy_id: randomUUID(), sense_id: null, canonical_approved: false, rawBody: "Original-only fake dictionary body." },
  senseId: null, definitionEn: "Selected definition.", exampleEn: "Selected example.", exampleKo: "선택 예문.",
  proofs: { definition: { state: "linked", value: "Selected definition.", ref: { fileHash: sha("proof-file"), valueHash: sha("proof-value"), pointer: "/fake/definition", line: 12 } },
    audio: { state: "review_required", value: "Original audio candidate.", ref: { fileHash: sha("audio-file"), valueHash: sha("audio-value"), pointer: "/fake/audio", line: null } } },
};
type Resources = { entryHash: string; linkRecordHash: string; selected: { schemaVersion: string; selectionId: string; selectionHash: string }; selectionBinding: { schemaVersion: string; bindingId: string; bindingHash: string } };
type Binding = { source: typeof source; entryLink: { id: string; sourceRef: string }; selectedDictionary: unknown; selectedSenseId: unknown; originalHashes: Record<string, string | null>;
  sourceIdentifiers: Record<string, unknown>; learningIdentity: { kind: string; key: string; senseId: string | null } };
describe.sequential("immutable shared vocabulary values and exact source bindings", () => {
  let db: PGlite; let stored: Resources;
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const register = (e: unknown = entry, o: unknown = null, choice: unknown = selected, s: unknown = source) => scalar<Resources>(
    "select private.register_vocabulary_learning_resources_v1($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) value",
    [e, o, { entryHash: entry.row_sha256.toLowerCase(), linkRecordHash: sha("link"), selected: choice }, s].map(x => JSON.stringify(x)));
  const readBinding = (r = stored) => scalar<Binding>("select private.resolve_vocabulary_learning_binding_v1($1::jsonb) value", [JSON.stringify(r)]);
  const count = () => scalar<{ values: number; bindings: number }>("select jsonb_build_object('values',(select count(*) from private.vocabulary_learning_value_versions),'bindings',(select count(*) from private.vocabulary_learning_value_bindings)) value");
  beforeAll(async () => { db = await createFinalSchemaDatabase(); }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("shares one exact value across two sources without merging their identities", async () => {
    stored = await register();
    expect(await register()).toEqual(stored);
    const nextEntry = { ...entry, id: entry.id + 1, source_row: 2, source_ref: "fake/book#2" };
    const nextSource = { ...source, sourceRow: 2, occurrenceKey: sha("occurrence:2") };
    const other = await register(nextEntry, null, selected, nextSource);
    expect(other.selected).toEqual(stored.selected);
    expect(other.selectionBinding.bindingId).not.toBe(stored.selectionBinding.bindingId);
    expect(await count()).toEqual({ values: 1, bindings: 2 });
    const a = await readBinding(), b = await readBinding(other);
    expect(a.entryLink.id).toBe(String(entry.id)); expect(b.entryLink.id).toBe(String(nextEntry.id));
    expect(a.learningIdentity.kind).toBe("source-occurrence-v1");
    expect(a.learningIdentity.key).not.toBe(b.learningIdentity.key);
  });
  it("retains every selected field and independent entry values, without source or dictionary bodies", async () => {
    const value = await scalar<{ entryValues: Record<string, unknown>; selectedFields: Record<string, unknown> }>("select private.resolve_vocabulary_learning_value_v1($1::jsonb) value", [JSON.stringify(stored.selected)]);
    for (const k of ["headword", "headword_normalized", "primary_meaning", "meanings", "pronunciation_ko", "english_definition", "example_en", "example_ko", "entry_type"] as const) expect(value.entryValues[k]).toEqual(entry[k]);
    for (const k of ["pronunciation", "lexicalPos", "definitionEn", "exampleEn", "exampleKo"] as const) expect(value.selectedFields[k]).toEqual(selected[k]);
    const binding = await readBinding();
    expect(binding.entryLink.sourceRef).toBe(entry.source_ref);
    expect(binding.selectedDictionary).toEqual({ dictionary_id: selected.dictionary.dictionary_id, legacy_id: selected.dictionary.legacy_id, sense_id: null, canonical_approved: false });
    const actualHash = await scalar("select private.reviewed_exam_sha256_v1($1::jsonb) value", [JSON.stringify(selected.dictionary)]);
    expect(binding.originalHashes.dictionarySnapshotHash).toBe(actualHash);
    const result = libraryResourceSchema.parse(await scalar("select private.vocabulary_composition_resource_v1($1::jsonb) value", [JSON.stringify(stored)]));
    expect(result).toMatchObject({ schemaVersion: "vocabulary-resource-selected-v2", pronunciation: selected.pronunciation, lexicalPos: selected.lexicalPos, definitionEn: selected.definitionEn, exampleEn: selected.exampleEn, exampleKo: selected.exampleKo });
    expect(result.proofs.audio).toEqual({ state: "review_required", ref: selected.proofs.audio.ref });
    expect(JSON.stringify([value, binding, result])).not.toMatch(/Original-only|Original source body|Original meaning body|Original audio candidate|"sourceFields"|"value":/);
  });
  it("keeps changed meanings apart and does not change learning identity merely for audio or example changes", async () => {
    const changedPron = await register(entry, null, { ...selected, exampleEn: "New selected example.", pronunciation: { ...selected.pronunciation, variantId: "fake:pron:2" } });
    expect(changedPron.selected.selectionId).not.toBe(stored.selected.selectionId);
    expect((await readBinding(changedPron)).learningIdentity).toEqual((await readBinding()).learningIdentity);
    const changedMeaning = await register({ ...entry, primary_meaning: "별개 뜻" });
    expect(changedMeaning.selected.selectionId).not.toBe(stored.selected.selectionId);
    expect((await readBinding(changedMeaning)).learningIdentity.key).not.toBe((await readBinding()).learningIdentity.key);
  });
  it("preserves reviewed payload identifiers even when the selected dictionary is null", async () => {
    const o = { payload: { dictionary_id: "word:source", occurrence_id: "fake-occurrence", source_entry_id: "source-row:1", source_entry_sha256: sha("original-row").toUpperCase(), sense_id: null, legacy_ids: [{ system: "legacy-word-index", id: randomUUID() }] } };
    const ref = await register(entry, o, { ...selected, dictionary: null }, { ...source, kind: "reviewed_exam", releaseId: randomUUID() });
    const b = await readBinding(ref);
    expect(b.selectedDictionary).toBeNull();
    expect(b.sourceIdentifiers).toMatchObject({ dictionaryId: o.payload.dictionary_id, occurrenceId: o.payload.occurrence_id, sourceEntryId: o.payload.source_entry_id, sourceEntryHash: o.payload.source_entry_sha256, legacyIds: o.payload.legacy_ids });
    expect(b.originalHashes.dictionarySnapshotHash).toBeNull();
    expect(b.originalHashes.occurrenceSnapshotHash).toEqual(await scalar("select private.reviewed_exam_sha256_v1($1::jsonb) value", [JSON.stringify(o)]));
  });
  it("preserves bigint IDs as exact strings without a JavaScript numeric conversion", async () => {
    const ref = await scalar<Resources>("select private.register_vocabulary_learning_resources_v1(jsonb_set($1::jsonb,'{id}',to_jsonb(9007199254740993::bigint)),null,$2::jsonb,$3::jsonb) value", [JSON.stringify(entry), JSON.stringify({ entryHash: entry.row_sha256.toLowerCase(), linkRecordHash: sha("bigint"), selected }), JSON.stringify(source)]);
    expect((await readBinding(ref)).entryLink.id).toBe("9007199254740993");
  });
  it("never interprets an unreviewed sense ID or canonical flag as approved meaning", async () => {
    const ref = await register(entry, null, { ...selected, senseId: "unreviewed:1", dictionary: { ...selected.dictionary, sense_id: "unreviewed:1", canonical_approved: true } });
    const b = await readBinding(ref);
    expect(b.selectedSenseId).toBe("unreviewed:1");
    expect(b.learningIdentity).toMatchObject({ kind: "source-occurrence-v1", senseId: null });
  });
  it("resolves an already compact reference without hashing the compact indexes as original content", async () => {
    const e = await scalar("select private.compact_vocabulary_source_snapshot_v1($1::jsonb,'entry') value", [JSON.stringify(entry)]);
    const again = await scalar("select private.register_vocabulary_learning_resources_v1($1::jsonb,null,$2::jsonb,$3::jsonb) value", [JSON.stringify(e), JSON.stringify(stored), JSON.stringify(source)]);
    expect(again).toEqual(stored);
    await expect(db.query("select private.register_vocabulary_learning_resources_v1($1::jsonb,null,$2::jsonb,$3::jsonb)", [JSON.stringify(entry), JSON.stringify(stored), JSON.stringify(source)])).rejects.toThrow("vocabulary_source_content_mismatch");
  });
  it("rejects missing or mismatched references instead of substituting current or empty values", async () => {
    for (const r of [
      { ...stored, selected: { ...stored.selected, selectionId: randomUUID() } },
      { ...stored, selected: { ...stored.selected, selectionHash: "f".repeat(64) } },
      { ...stored, selectionBinding: { ...stored.selectionBinding, bindingHash: "e".repeat(64) } },
      { ...stored, selectionBinding: undefined },
    ]) await expect(db.query("select private.vocabulary_composition_resource_v1($1::jsonb)", [JSON.stringify(r)])).rejects.toThrow(/vocabulary_/);
    expect(await scalar("select private.vocabulary_composition_resource_v1($1::jsonb) value", [JSON.stringify({ selected })])).toEqual(selected);
  });
  it("rolls back invalid proofs and unknown display fields without partial registrations", async () => {
    const before = await count();
    for (const choice of [
      { ...selected, extraBody: "No raw body" },
      { ...selected, pronunciation: { ...selected.pronunciation, raw: "audio bytes" } },
      { ...selected, proofs: { definition: { ...selected.proofs.definition, value: null } } },
      { ...selected, proofs: { definition: { ...selected.proofs.definition, ref: null } } },
      { ...selected, proofs: { unknown: selected.proofs.definition } },
    ]) await expect(register(entry, null, choice)).rejects.toThrow(/vocabulary_/);
    expect(await count()).toEqual(before);
  });
  it("checks strict raw audio paths consistently in SQL and the new TypeScript contract", async () => {
    const base = `https://${"a".repeat(20)}.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/`;
    for (const audioUrl of [selected.pronunciation.audioUrl, `${base}fake.mp3`, ...["..", ".", "%2E", ".%2e", "%2e.", "%2e%2e"].map(s => `${base}${s}/fake.mp3`), `${base}a\\..\\fake.mp3`, `${base}fake.mp3?`, base.replace("https", "HTTPS") + "fake.mp3"]) {
      const p = { ...selected.pronunciation, audioUrl };
      const expected = learningPronunciationSchema.safeParse(p).success;
      const sql = db.query("select private.validate_vocabulary_pronunciation_v1($1::jsonb)", [JSON.stringify(p)]);
      if (expected) await expect(sql).resolves.toBeDefined(); else await expect(sql).rejects.toThrow(/vocabulary_/);
    }
  });
  it("uses RLS and closed function grants for all application roles and rejects owner mutations", async () => {
    const tables = ["vocabulary_learning_value_versions", "vocabulary_learning_value_bindings", "vocabulary_composition_storage_formats"];
    expect(await scalar("select bool_and(relrowsecurity) value from pg_class where relnamespace='private'::regnamespace and relname=any($1::text[])", [tables])).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      try {
        for (const table of tables) await expect(db.query(`select * from private.${table}`)).rejects.toThrow(/permission denied/);
        await expect(register()).rejects.toThrow(/permission denied/);
        await expect(db.query("select private.vocabulary_composition_resource_v1($1::jsonb)", [JSON.stringify(stored)])).rejects.toThrow(/permission denied/);
      } finally { await db.exec("reset role"); }
    }
    for (const table of tables.slice(0, 2)) {
      await expect(db.query(`update private.${table} set payload=payload`)).rejects.toThrow(/immutable/);
      await expect(db.query(`delete from private.${table}`)).rejects.toThrow(/immutable/);
    }
  });
  it("counts fixed dictionary and learning keys without merging unreviewed meanings or hiding broken references", async () => {
    const second = await register({ ...entry, id: entry.id + 2, source_row: 3 }, null, selected, { ...source, sourceRow: 3, occurrenceKey: sha("m07-second") });
    const first = { key: "a", resources: stored }, another = { key: "b", resources: second };
    const quantities = (occurrences: unknown[], includedKeys = ["a", "b"]) => scalar("select private.vocabulary_library_quantities_v1($1::jsonb) value", [JSON.stringify({ occurrences, includedKeys })]);
    expect(await quantities([first, another, first])).toEqual({ uniqueWordCount: 1, unknownWordItems: 0, meaningItemCount: 2, unknownMeaningItems: 0, sourceSpecificMeaningItems: 2, questionCounts: null });
    expect(await quantities([first, another], ["a"])).toMatchObject({ uniqueWordCount: 1, meaningItemCount: 1 });
    expect(await quantities([{ key: "a", resources: { selected } }], ["a"])).toMatchObject({ uniqueWordCount: 1, meaningItemCount: null, unknownMeaningItems: 1 });
    expect(await quantities([{ key: "a" }], ["a"])).toMatchObject({ uniqueWordCount: null, unknownWordItems: 1, meaningItemCount: null });
    await expect(quantities([{ key: "a", resources: { ...stored, selectionBinding: { ...stored.selectionBinding, bindingHash: "e".repeat(64) } } }], ["a"])).rejects.toThrow("vocabulary_binding_unavailable");
    for (const schemaVersion of [undefined, "broken-reference-format"]) {
      await expect(quantities([{ key: "a", resources: { ...stored, selected: { ...stored.selected, schemaVersion } } }], ["a"])).rejects.toThrow(/vocabulary_/);
    }
    await expect(quantities([first])).rejects.toThrow("library_quantity_reference_missing");
  });
});
