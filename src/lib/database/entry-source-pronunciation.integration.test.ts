import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { nucleusFixture } from "@/test-support/pronunciation-fixtures";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";

describe.sequential("entry source pronunciation final schema", () => {
  let db: PGlite;
  let entryId: number;
  const fixture = nucleusFixture();
  const original = fixture.identities[0];
  const read = (ids: number[] | null = [entryId]) => db.query<{vocab_entry_id:number;headword:string;display_ko:string}>("select * from public.list_entry_source_pronunciations_v1($1::bigint[])", [ids]);
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

    await db.query(`insert into private.entry_source_pronunciations_v1
      (vocab_entry_id,entry_row_sha256,headword,lexical_pos,source_kind,identity_id,identity_content_sha256,variant_id,audio_key,display_ko,segments,source_file_sha256,manifest_sha256,review_work)
      values($1,$2,'test','noun','identity',$3,$4,$5,$6,'복원','[{"text":"복원","stress":"primary"}]',repeat('a',64),repeat('b',64),'WORD-20260909-02')`,
      [entryId,fixture.bindings[0].entry_row_sha256.toLowerCase(),original.identity_id,original.identity_content_sha256.toLowerCase(),original.pronunciation_variant_id,original.official_audio_url]);
    await db.query(`insert into word_index.app_exam_use_occurrence
      (release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,dictionary_id,display_headword,display_gloss_ko,
       display_pronunciation_review_status,audio_status,listening_enabled,occurrence_id,occurrence_content_hash,package_entry_content_hash,
       exam_review_id,exam_input_hash,exam_use_status,context_evidence_status,context_evidence,source_projection_row_sha256,
       source_entry_id,source_entry_sha256,include_in_exam,audio_json,package_entry_json,pronunciation_variant_id,audio_url,sound_audio,raw_response_sha256)
      select $1,$2,2,e.id,$3,2,'word:legacy','test','가짜','candidate','raw_attached',true,'occ:fake2',repeat('9',64),repeat('6',64),
       'exam-review:fake2',repeat('7',64),'reviewed_for_preview','source_entry_context','{}',lower(e.row_sha256),'fake2',repeat('8',64),true,
       '{"variant_pos":"noun"}','{}',$4,$5,'test0001',repeat('a',64) from public.vocab_entries e where e.dataset_id=$2 and e.source_row=2`,
      [release,dataset,unit,original.pronunciation_variant_id,original.official_audio_url]);
    await db.query(`insert into private.entry_source_pronunciations_v1
      (vocab_entry_id,entry_row_sha256,headword,lexical_pos,source_kind,occurrence_release_id,occurrence_content_hash,variant_id,audio_key,display_ko,segments,source_file_sha256,manifest_sha256,review_work)
      select e.id,lower(e.row_sha256),'test','noun','occurrence',$2,repeat('9',64),$3,$4,'교재','[{"text":"교재","stress":"primary"}]',repeat('a',64),repeat('b',64),'WORD-20260909-02'
      from public.vocab_entries e where e.dataset_id=$1 and e.source_row=2`,[dataset,release,original.pronunciation_variant_id,original.official_audio_url]);
    await db.query(`insert into public.vocab_entry_pronunciations
      (vocab_entry_id,dataset_id,source_row,entry_row_sha256,headword_normalized,provider,status,review_status,needs_review,listening_enabled,
       selected_variant_id,selected_audio_url,selected_sound_audio,selected_pos,variants,raw_provenance,source_package_version,content_sha256)
      select e.id,e.dataset_id,3,e.row_sha256,'test','merriam_webster','raw_first_variant_unreviewed','raw_unreviewed',true,true,$2,$3,'test0001','noun',
       jsonb_build_array(jsonb_build_object('variant_id',$2::text,'audio_url',$3::text,'pos','noun')),'[]',repeat('A',64),repeat('C',64)
      from public.vocab_entries e where e.dataset_id=$1 and e.source_row=3`,[dataset,original.pronunciation_variant_id,original.official_audio_url]);
    await db.query(`insert into private.entry_source_pronunciations_v1
      (vocab_entry_id,entry_row_sha256,headword,lexical_pos,source_kind,registry_content_sha256,variant_id,audio_key,display_ko,segments,source_file_sha256,manifest_sha256,review_work)
      select e.id,lower(e.row_sha256),'test','noun','registry',repeat('c',64),$2,$3,'사전','[{"text":"사전","stress":"primary"}]',repeat('a',64),repeat('b',64),'WORD-20260909-02'
      from public.vocab_entries e where e.dataset_id=$1 and e.source_row=3`,[dataset,original.pronunciation_variant_id,original.official_audio_url]);

  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("resolves active, occurrence and repaired registry without changing legacy approval",async()=>{
    expect((await read([entryId,entryId+1,entryId+2])).rows.map(r=>r.display_ko)).toEqual(["복원","교재","사전"]);
    expect((await read([entryId,entryId])).rows).toHaveLength(1);
    expect((await db.query("select * from public.list_entry_approved_korean_pronunciations_v1($1::bigint[])",[[entryId]])).rows).toHaveLength(1);
  });
  it.each([null,[0],[-1],Array(401).fill(1)])("rejects invalid/broad input %#",async ids=>await expect(read(ids)).rejects.toThrow("entry_source_input_invalid"));
  it("empty input has no data",async()=>expect((await read([])).rows).toEqual([]));
  it.each([
    "update private.entry_source_pronunciations_v1 set entry_row_sha256=repeat('e',64)",
    "update private.entry_source_pronunciations_v1 set headword='other'",
    "update private.entry_source_pronunciations_v1 set lexical_pos='verb'",
    "update private.entry_source_pronunciations_v1 set variant_id='mw:other'",
    "update private.entry_source_pronunciations_v1 set audio_key='https://evil.example/a.mp3'",
    "update private.entry_source_pronunciations_v1 set identity_content_sha256=repeat('e',64) where source_kind='identity'",
    "update public.vocab_entry_pronunciation_bindings_v2 set is_entry_default=false",
    "update public.vocab_entry_pronunciation_bindings_v2 set headword_normalized='other'",
    "update public.vocab_entry_pronunciation_bindings_v2 set lexical_pos='verb'",
    "update public.vocab_entry_pronunciation_bindings_v2 set entry_row_sha256=repeat('E',64)",
    "update public.vocab_pronunciation_releases_v2 set status='retired', retired_at=now()"
  ])("rejects mismatched active proof: %s",async sql=>{
    await db.exec("begin");try{await db.exec(sql);expect((await read()).rows).toHaveLength(0);}finally{await db.exec("rollback");}
  });
  it.each([
    ["occurrence","update word_index.app_exam_use_occurrence set occurrence_content_hash=repeat('e',64)"],
    ["occurrence","update word_index.app_exam_use_occurrence set source_projection_row_sha256=repeat('e',64)"],
    ["occurrence","update word_index.app_exam_use_occurrence set audio_json='{}'"],
    ["registry","update public.vocab_entry_pronunciations set content_sha256=repeat('E',64)"],
    ["registry","update public.vocab_entry_pronunciations set selected_pos='verb'"]
  ])("rejects mismatched %s proof: %s",async(kind,sql)=>{
    const id=entryId+(kind==="occurrence"?1:2);
    await db.exec("begin");try{await db.exec(sql);expect((await read([id])).rows).toHaveLength(0);}finally{await db.exec("rollback");}
  });
  it("rejects incomplete proof, duplicate exact voices and invalid segments at write boundary",async()=>{
    for(const sql of [
      "update private.entry_source_pronunciations_v1 set identity_content_sha256=null where source_kind='identity'",
      "update private.entry_source_pronunciations_v1 set segments='[]'",
      "insert into private.entry_source_pronunciations_v1 select * from private.entry_source_pronunciations_v1"
    ])await expect(db.exec(sql)).rejects.toThrow();
  });
  it.each([2, 3])("preserves generation %s user-approved identity displays", async (generation) => {
    await db.exec("begin");
    try {
      if (generation === 2) {
        const oldId = "pron:v2:" + "9".repeat(64);
        await db.query(`insert into public.vocab_pronunciation_identities_v2
          select (jsonb_populate_record(null::public.vocab_pronunciation_identities_v2, to_jsonb(i) ||
            jsonb_build_object('identity_id',$2::text,'engine_version','cmudict-arpabet-hangul-render-v1','display_source','deterministic_rule_v1'))).*
          from public.vocab_pronunciation_identities_v2 i where i.identity_id=$1`, [original.identity_id, oldId]);
        await db.query("update public.vocab_entry_pronunciation_bindings_v2 set identity_id=$1", [oldId]);
        await db.query("update private.entry_source_pronunciations_v1 set identity_id=$1 where source_kind='identity'", [oldId]);
      }
      expect((await read()).rows).toHaveLength(1);
      await db.query("update public.vocab_pronunciation_identities_v2 set display_source=$1 where identity_id=$2", [
        generation === 2 ? "user_approved_100_identity_v1" : "user_approved_display_nucleus_projection_v2",
        generation === 2 ? "pron:v2:" + "9".repeat(64) : original.identity_id,
      ]);
      expect((await read()).rows).toHaveLength(0);
    } finally { await db.exec("rollback"); }
  });
  it("does not allow an explicit identity POS to bypass an ordinary binding", async () => {
    await db.exec("begin");
    try {
      await db.exec("update public.vocab_pronunciation_identities_v2 set lexical_pos='other'");
      await db.exec("update private.entry_source_pronunciations_v1 set identity_lexical_pos='other' where source_kind='identity'");
      expect((await read()).rows).toHaveLength(0);
    } finally { await db.exec("rollback"); }
  });
  it.each(["occurrence", "registry"])("rejects explicit identity POS for %s", async (kind) => {
    await expect(db.query("update private.entry_source_pronunciations_v1 set identity_lexical_pos='other' where source_kind=$1", [kind])).rejects.toThrow();
  });
  it("does not allow an explicit source headword to bypass an ordinary binding", async () => {
    await db.exec("begin");
    try {
      await db.exec("update public.vocab_pronunciation_identities_v2 set headword='test/alternative'");
      await db.exec("update private.entry_source_pronunciations_v1 set identity_headword='test/alternative' where source_kind='identity'");
      expect((await read()).rows).toHaveLength(0);
    } finally { await db.exec("rollback"); }
  });
  it.each(["occurrence", "registry"])("rejects explicit source headword for %s", async (kind) => {
    await expect(db.query("update private.entry_source_pronunciations_v1 set identity_headword='test/alternative' where source_kind=$1", [kind])).rejects.toThrow();
  });
  it.each(["", " test ", "test"])("rejects invalid or redundant source headword: %s", async (value) => {
    await expect(db.query("update private.entry_source_pronunciations_v1 set identity_headword=$1 where source_kind='identity'", [value])).rejects.toThrow();
  });
  it.each(["", " noun ", "noun"])("rejects invalid or redundant identity POS: %s", async (value) => {
    await expect(db.query("update private.entry_source_pronunciations_v1 set identity_lexical_pos=$1 where source_kind='identity'", [value])).rejects.toThrow();
  });
  it("limits access to the service reader and leaves exams/identities unchanged",async()=>{
    const before=(await db.query("select (select count(*) from quiz_questions) q,(select jsonb_agg(to_jsonb(i)) from vocab_pronunciation_identities_v2 i) i")).rows;
    for(const role of ["anon","authenticated","service_role"]){
      await db.exec("set role "+role);
      try{
        await expect(db.query("select * from private.entry_source_pronunciations_v1")).rejects.toThrow(/permission denied/);
        if(role==="service_role")expect((await read()).rows).toHaveLength(1);
        else await expect(read()).rejects.toThrow(/permission denied/);
      }finally{await db.exec("reset role");}
    }
    expect((await db.query("select (select count(*) from quiz_questions) q,(select jsonb_agg(to_jsonb(i)) from vocab_pronunciation_identities_v2 i) i")).rows).toEqual(before);
  });
});
