import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { nucleusFixture } from "@/test-support/pronunciation-fixtures";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";

describe.sequential("exact entry approved pronunciation final schema", () => {
  let db: PGlite;
  let entryId: number;
  const fixture = nucleusFixture();
  const original = fixture.identities[0];
  const read = (ids: number[] | null = [entryId]) =>
    db.query<{ vocab_entry_id: number; dictionary_id: string; approval: Record<string, unknown>; identity: Record<string, unknown> }>(
      "select * from public.list_entry_approved_korean_pronunciations_v1($1::bigint[])", [ids]);
  const call = (name: string, ...args: unknown[]) =>
    db.query("select public." + name + "(" + args.map((_, i) => "$" + (i + 1)).join(",") + ")", args.map(v => typeof v === "string" ? v : JSON.stringify(v)));
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    const dataset = (await db.query<{ id: string }>(
      "insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count) values($1,'Fake','fake',$2,$3) returning id",
      [fixture.dataset_key, fixture.dataset_source_sha256, fixture.bindings.length])).rows[0].id;
    const unit = (await db.query<{ id: string }>(
      "insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,'DAY 01','day 01','day',1,1,$2) returning id",
      [dataset, fixture.bindings.length])).rows[0].id;
    const entries = await db.query<{ id: number }>(`insert into public.vocab_entries(dataset_id,source_row,row_sha256,headword,headword_normalized,meanings,primary_meaning,unit_id,position_in_unit,entry_type)
      select $1,r.source_row,r.entry_row_sha256,r.headword,r.headword_normalized,array['가짜'],'가짜',$3,r.source_row,'word'
      from jsonb_to_recordset($2::jsonb) r(source_row integer,entry_row_sha256 text,headword text,headword_normalized text) returning id`,
      [dataset, JSON.stringify(fixture.bindings), unit]);
    entryId = entries.rows[0].id;
    await db.exec("set role service_role");
    await call("stage_vocab_pronunciation_release_v3", vocabPronunciationReleaseHeader(fixture as Parameters<typeof vocabPronunciationReleaseHeader>[0]));
    await call("import_vocab_pronunciation_identity_batch_v3", fixture.release_id, fixture.identities);
    for (let i = 0; i < fixture.bindings.length; i += 400) await call("import_vocab_pronunciation_binding_batch_v3", fixture.release_id, fixture.bindings.slice(i, i + 400));
    await call("verify_vocab_pronunciation_release_v3", fixture.release_id);
    await call("activate_vocab_pronunciation_release_v3", fixture.release_id);
    await db.exec("reset role");
    const release = (await db.query<{ release_id: string }>(`insert into word_index.app_exam_use_release
      (release_key,dataset_id,dataset_key,schema_version,package_version,source_sha256,candidate_dictionary_version,manifest_content_hash,
       exam_review_ledger_sha256,wordbook_id,title,target_environment,common_dictionary_release_allowed,exam_use_import_allowed,
       expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json)
      values('fake-source',$1,$2,'1.0',repeat('1',64),$3,repeat('2',64),repeat('3',64),repeat('4',64),
       'fake','Fake','preview',false,true,1,1,1,'active','{}') returning release_id`,
      [dataset, fixture.dataset_key, fixture.dataset_source_sha256.toLowerCase()])).rows[0].release_id;
    await db.query(`insert into word_index.app_exam_use_occurrence
      (release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,dictionary_id,display_headword,display_gloss_ko,
       display_pronunciation_review_status,audio_status,listening_enabled,occurrence_id,occurrence_content_hash,package_entry_content_hash,
       exam_review_id,exam_input_hash,exam_use_status,context_evidence_status,context_evidence,source_projection_row_sha256,
       source_entry_id,source_entry_sha256,include_in_exam,audio_json,package_entry_json)
      values($1,$2,1,$3,$4,1,'word:test','test','가짜','candidate','disabled',false,'occ:fake',repeat('5',64),repeat('6',64),
       'exam-review:fake',repeat('7',64),'reviewed_for_preview','source_entry_context','{}',$5,'fake',repeat('8',64),true,'{}','{}')`,
      [release, dataset, entryId, unit, fixture.bindings[0].entry_row_sha256.toLowerCase()]);
    await db.query(`insert into public.vocab_approved_korean_pronunciations
      (dictionary_id,pronunciation_variant_id,display_pronunciation_ko,segments,review_status,source_content_sha256,source_review_run_id)
      values('word:test',$1,'승인','[{"text":"승인","stress":"primary"}]','approved',$2,'user-directed:TEST')`,
      [original.pronunciation_variant_id, original.identity_content_sha256.toLowerCase()]);
  }, 60_000);
  afterAll(async () => { await db?.close(); });
  it("resolves active source with a NULL occurrence variant without rewriting stored audio", async () => {
    const rows = (await read()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vocab_entry_id: entryId, dictionary_id: "word:test", approval: { display_pronunciation_ko: "승인" } });
    expect(rows[0].identity.display_pronunciation_ko).toBe("테스트");
    expect(rows[0].identity.official_audio_url).toBe(original.official_audio_url);
    expect((await read([entryId, entryId])).rows).toHaveLength(1);
    expect((await read([entryId + 1])).rows).toHaveLength(0);
    expect((await read([])).rows).toHaveLength(0);
  });
  it("rejects malformed or unbounded input", async () => {
    for (const ids of [null, [0], [-1], Array(501).fill(entryId)]) await expect(read(ids)).rejects.toThrow("entry_approved_input_invalid");
  });
  it("accepts source restoration only through the same exact identity proof", async () => {
    await db.exec("begin");
    try {
      await db.exec("update public.vocab_approved_korean_pronunciations set source_review_run_id='source-restored:TEST'");
      expect((await read()).rows).toHaveLength(1);
      await db.exec("update public.vocab_approved_korean_pronunciations set source_content_sha256=repeat('b',64)");
      expect((await read()).rows).toHaveLength(0);
    } finally { await db.exec("rollback"); }
    expect((await read()).rows[0].approval.source_review_run_id).toBe("user-directed:TEST");
  });
  it.each(["source-restored:", "source-restored: bad", "source-restored-ish:TEST"])("rejects malformed restoration source %s", async (review) => {
    await db.exec("begin");
    try {
      await db.query("update public.vocab_approved_korean_pronunciations set source_review_run_id=$1", [review]);
      expect((await read()).rows).toHaveLength(0);
    } finally { await db.exec("rollback"); }
  });
  it.each([
    "update public.vocab_approved_korean_pronunciations set source_content_sha256=repeat('f',64)",
    "update public.vocab_approved_korean_pronunciations set source_review_run_id='legacy' where source_review_run_id='user-directed:TEST'",
    "update public.vocab_approved_korean_pronunciations set pronunciation_variant_id='mw:other' where source_review_run_id='user-directed:TEST'",
    "update word_index.app_exam_use_occurrence set dictionary_id='word:other'",
    "update word_index.app_exam_use_occurrence set source_projection_row_sha256=repeat('f',64)",
    "update word_index.app_exam_use_occurrence set source_row=501",
    "update word_index.app_exam_use_occurrence set display_headword='other'",
    "update word_index.app_exam_use_release set source_sha256=repeat('f',64)",
    "update word_index.app_exam_use_release set status='retired'",
    "update public.vocab_pronunciation_releases_v2 set status='retired', retired_at=now()",
    "update public.vocab_entry_pronunciation_bindings_v2 set lexical_pos='verb'",
    "update public.vocab_entry_pronunciation_bindings_v2 set headword_normalized='other'",
    "update public.vocab_entry_pronunciation_bindings_v2 set is_entry_default=false",
    "update public.vocab_entry_pronunciation_bindings_v2 set entry_row_sha256=repeat('F',64)",
  ])("fails closed when a source edge changes: %s", async (sql) => {
    await db.exec("begin");
    try { await db.exec(sql); expect((await read()).rows).toHaveLength(0); }
    finally { await db.exec("rollback"); }
    expect((await read()).rows).toHaveLength(1);
  });
  it("read only and server only, no public or direct private execution", async () => {
    const before = await db.query("select (select count(*) from public.quiz_questions) n, (select jsonb_agg(to_jsonb(i)) from public.vocab_pronunciation_identities_v2 i) identities");
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      await expect(read()).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect((await read()).rows).toHaveLength(1);
    await expect(db.query("select * from private.list_entry_approved_korean_pronunciations_v1($1)", [[entryId]])).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    expect((await db.query("select (select count(*) from public.quiz_questions) n, (select jsonb_agg(to_jsonb(i)) from public.vocab_pronunciation_identities_v2 i) identities")).rows).toEqual(before.rows);
    const sql = readFileSync("supabase/migrations/20260907121138_add_entry_approved_korean_pronunciation.sql", "utf8");
    expect(sql).not.toMatch(/\b(insert into|update public|delete from)\b/i);
  });
});
