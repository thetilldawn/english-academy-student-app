import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { reviewedExamFixture, reviewedFixtureId as id, reviewedFixtureModes } from "@/test-support/reviewed-exam-fixtures";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";

describe.sequential("reviewed exam bank final schema", () => {
  let db: PGlite;
  const fixture=reviewedExamFixture();
  let releaseId:string; let datasetId:string;
  const assignments=new Map<string,string>();
  const scalar=async <T>(sql:string,args:unknown[]=[]) => (await db.query<{value:T}>(sql,args)).rows[0]!.value;
  const rpc=async(name:string,...args:unknown[])=>scalar(`select public.${name}(${args.map((_,i)=>"$"+(i+1)).join(",")}) value`,args.map(a=>typeof a==="string"?a:JSON.stringify(a)));
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${id(1)}');
      insert into public.admin_profiles(user_id,display_name) values('${id(1)}','가짜 관리자');
      insert into public.students(id,display_name,created_by) values('${id(2)}','가짜 학생','${id(1)}'),('${id(3)}','다른 가짜 학생','${id(1)}');
      select set_config('request.jwt.claim.sub','${id(1)}',false);
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claims','{"role":"authenticated","ref":"wojxpruvbjzbhrpmsbuy"}',false);`);
    const voice=fixture.voice;
    const priorId=await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count) values($1,'가짜 이전 자료','fake',$2,278) returning id value",[voice.dataset_key,voice.dataset_source_sha256]);
    const unitId=await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,sort_index,entry_count) values($1,'가짜 이전 범위','fake','supplement',1,278) returning id value",[priorId]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,is_assignable) values($1,'가짜 모의고사','high_mock','exam_prep',false)",[priorId]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,row_sha256,headword,headword_normalized,meanings,primary_meaning,unit_id,position_in_unit,entry_type)
      select $1,r.source_row,r.entry_row_sha256,r.headword,r.headword_normalized,array['가짜'],'가짜',$3,r.source_row,'word'
      from jsonb_to_recordset($2::jsonb) r(source_row int,entry_row_sha256 text,headword text,headword_normalized text)`,[priorId,JSON.stringify(voice.bindings),unitId]);
    await rpc("stage_school_pronunciation_release_v1",vocabPronunciationReleaseHeader(voice as never));
    await rpc("import_vocab_pronunciation_identity_batch_v3",voice.release_id,voice.identities);
    await rpc("import_vocab_pronunciation_binding_batch_v3",voice.release_id,voice.bindings);
    await rpc("verify_vocab_pronunciation_release_v3",voice.release_id);
    await rpc("activate_vocab_pronunciation_release_v3",voice.release_id);
  }, 60_000);
  afterAll(async () => { await db?.close(); });
  it("installs the current schema and preserves both delivery entry points", async () => {
    const result = await db.query<{ count: number }>("select count(*)::int as count from pg_proc where proname in ('create_reviewed_bank_for_delivery_v1','create_canonical_bank_for_delivery_v1')");
    expect(result.rows[0].count).toBe(2);
  });
  it("canonical content hashing matches UTF-8 object ordering", async () => {
    const value = { b: [1, null, true, "영어"], a: "word" };
    const result = await db.query<{ value: string }>("select private.reviewed_exam_canonical_json_v1($1::jsonb) value", [JSON.stringify(value)]);
    expect(result.rows[0].value).toBe('{"a":"word","b":[1,null,true,"영어"]}');
  });
  it.each(["anon", "authenticated"])("%s cannot read the bank or resolve audio directly", async role => {
    await db.exec("set role " + role);
    try {
      await expect(db.query("select * from private.reviewed_exam_items")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.list_active_vocab_pronunciation_bindings_v3(array[1]::bigint[])")).rejects.toThrow(/permission denied/);
      await expect(db.query("select private.import_reviewed_exam_bundle_v1('{}')")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });
  it("refuses a bundle with no deployment-specific approval", async () => {
    await expect(db.query("select private.import_reviewed_exam_bundle_v1('{}')")).rejects.toThrow("reviewed_exam_import_not_approved");
  });
  it("imports all 278 artificial entries and 1112 hashed items, then activates only that approved content",async()=>{
    await db.query("insert into private.reviewed_exam_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,$2,$3,278,1112,'fake-approval')",[fixture.fileHash,fixture.bundle.content_sha256,fixture.bundle.dataset.key]);
    const imported=await scalar<{release_id:string;dataset_id:string;entries:number;questions:number}>("select private.import_reviewed_exam_bundle_v1($1) value",[fixture.text]);
    expect(imported).toMatchObject({entries:278,questions:1112});
    releaseId=imported.release_id;datasetId=imported.dataset_id;
    expect(await scalar("select private.import_reviewed_exam_bundle_v1($1) value",[fixture.text])).toMatchObject({reused:true});
    await db.query("select private.activate_reviewed_exam_release_v1($1,$2)",[releaseId,fixture.bundle.content_sha256]);
    expect(await scalar("select count(*)::int value from public.vocab_units where dataset_id=$1",[datasetId])).toBe(20);
  });
  it("restores reviewed entry through its own fixed identity and rejects changed payload", async () => {
    await db.exec("begin");
    try {
      const entry=(await db.query<{vocab_entry_id:number}>(`insert into private.entry_source_pronunciations_v1
        (vocab_entry_id,entry_row_sha256,headword,lexical_pos,source_kind,identity_id,identity_content_sha256,variant_id,audio_key,display_ko,segments,source_file_sha256,manifest_sha256,review_work)
        select re.vocab_entry_id,re.entry_sha256,re.payload->>'headword',re.payload->>'lexical_pos','identity',i.identity_id,lower(i.identity_content_sha256),
          i.pronunciation_variant_id,i.official_audio_url,'교정','[{"text":"교정","stress":"primary"}]',repeat('a',64),repeat('b',64),'WORD-20260909-02'
        from private.reviewed_exam_entries re join public.vocab_pronunciation_identities_v2 i on i.identity_id=re.pronunciation_identity_id
        where re.release_id=$1 and re.source_row=1 returning vocab_entry_id`,[releaseId])).rows[0]!.vocab_entry_id;
      expect((await db.query("select * from public.list_entry_source_pronunciations_v1($1::bigint[])",[[entry]])).rows).toMatchObject([{headword:"alpha",display_ko:"교정"}]);
      await db.query("update private.reviewed_exam_entries set payload=jsonb_set(payload,'{lexical_pos}','\"verb\"') where vocab_entry_id=$1",[entry]);
      expect((await db.query("select * from public.list_entry_source_pronunciations_v1($1::bigint[])",[[entry]])).rows).toHaveLength(0);
    } finally { await db.exec("rollback"); }
  });
  async function targets(mode:string,direction:string,unitLimit=1) {
    const units=(await db.query<{id:string}>("select id from public.vocab_units where dataset_id=$1 order by sort_index limit $2",[datasetId,unitLimit])).rows.map(r=>r.id);
    const rows=(await db.query<{vocab_entry_id:number;item_id:string;item_sha256:string}>(`select i.vocab_entry_id,i.item_id,i.item_sha256 from private.reviewed_exam_items i join public.vocab_entries e on e.id=i.vocab_entry_id
      where i.release_id=$1 and i.quiz_mode=$2 and i.direction::text=$3 and e.unit_id=any($4) order by e.source_row`,[releaseId,mode,direction,units])).rows;
    return {units,questions:rows.map((r,i)=>({vocab_entry_id:r.vocab_entry_id,base_order_index:i+1,direction,
      reviewed_bank:{source:"reviewed_exam_v1",mode,release_id:releaseId,package_sha256:fixture.fileHash,question_item_id:r.item_id,question_item_sha256:r.item_sha256}}))};
  }
  async function create(mode:string,direction:string,questions:unknown[],units:string[]){
    return scalar<string>(`select private.create_assignment_with_delivery_v7('가짜 시험',$1::uuid,$2::uuid[],$3::integer,$4::smallint,300,80::smallint,'fixed'::public.question_order_mode,null,array['${id(2)}']::uuid[],'none',null,$5::jsonb) value`,
      [datasetId,units,questions.length,direction==="english_to_korean"?100:0,JSON.stringify(questions)]);
  }
  it.each(reviewedFixtureModes)("%s %s freezes the reviewed question and serves only assigned study words",async(mode,direction)=>{
    const {units,questions}=await targets(mode,direction);
    const assignment=await create(mode,direction,questions,units); assignments.set(`${mode}:${direction}`,assignment);
    const stored=await scalar<Record<string,unknown>>("select to_jsonb(a) value from public.assignments a where id=$1",[assignment]);
    expect(stored).toMatchObject({question_count:12,question_bank_version:4,provenance_status:"exam_reviewed_v1",quiz_content_mode:mode,reviewed_exam_release_id_snapshot:releaseId});
    const study=await scalar<{words:Record<string,unknown>[]}>("select public.get_student_assignment_study_v1($1,$2) value",[id(2),assignment]);
    expect(study.words).toHaveLength(12);
    expect(study.words.every(w=>mode.includes("definition") ? typeof w.definition==="string" : w.definition===null)).toBe(true);
    expect(JSON.stringify(study)).not.toMatch(/choice_texts|correct_choice|item_sha256|choice_source_rows/);
    expect(await scalar("select public.get_student_assignment_study_v1($1,$2) value",[id(3),assignment])).toBeNull();
  });
  it("rejects changed hashes atomically using a permanent queue-error category",async()=>{
    const {units,questions}=await targets("book_meaning_choice","english_to_korean");
    const before=await scalar("select count(*)::int value from public.assignments");
    questions[0]!.reviewed_bank.question_item_sha256="f".repeat(64);
    await expect(create("book_meaning_choice","english_to_korean",questions,units)).rejects.toMatchObject({code:"55000",message:"reviewed_assignment_snapshot_mismatch"});
    expect(await scalar("select count(*)::int value from public.assignments")).toBe(before);
  });
  it.each([1,3])("supports %i exact wrong words without relaxing the regular minimum",async count=>{
    const {units,questions}=await targets("book_meaning_choice","english_to_korean");
    const plans=await db.query("select vocab_entry_id,base_order_index,direction,choice_vocab_entry_ids from public.assignment_questions where assignment_id=$1 order by base_order_index limit $2",[assignments.get("book_meaning_choice:english_to_korean"),count]);
    const assignment=await scalar<string>(`select private.create_exact_review_assignment_with_delivery_v1('가짜 오답',$1::uuid,$2::uuid[],$3::int,100::smallint,300,80::smallint,'fixed',null,array['${id(3)}']::uuid[],'none',null,$4::jsonb) value`,[datasetId,units,count,JSON.stringify(plans.rows)]);
    expect(await scalar("select question_count value from public.assignments where id=$1",[assignment])).toBe(count);
    await expect(create("book_meaning_choice","english_to_korean",questions.slice(0,count),units)).rejects.toMatchObject({code:"22023"});
  });
  it.each(reviewedFixtureModes)("%s %s preserves type and snapshots during a settings-only edit",async(mode,direction)=>{
    const source=assignments.get(`${mode}:${direction}`)!;
    const {units}=await targets(mode,direction);
    const plan=(await db.query("select vocab_entry_id,base_order_index,direction,choice_vocab_entry_ids from public.assignment_questions where assignment_id=$1 order by base_order_index",[source])).rows;
    const key=id(500+reviewedFixtureModes.findIndex(([m,d])=>m===mode&&d===direction));
    const changed=await scalar<{replacementAssignmentId:string}>(`select public.replace_student_assignment_v7($1::uuid,'${id(2)}',$2::uuid,$3,'regular','none','가짜 시험',$4::uuid,$5::uuid[],12,$6::smallint,300,85::smallint,false,null,'fixed',null,null,'none',null,'{}'::smallint[],'dataset','{}'::uuid[],$7::jsonb) value`,[source,key,"a".repeat(64),datasetId,units,direction==="english_to_korean"?100:0,JSON.stringify(plan)]);
    const stored=await scalar<Record<string,unknown>>("select to_jsonb(a) value from public.assignments a where id=$1",[changed.replacementAssignmentId]);
    expect(stored).toMatchObject({quiz_content_mode:mode,provenance_status:"exam_reviewed_v1",passing_score:85});
    const copied=(await db.query("select vocab_entry_id,base_order_index,direction,choice_vocab_entry_ids from public.assignment_questions where assignment_id=$1 order by base_order_index",[changed.replacementAssignmentId])).rows;
    expect(copied).toEqual(plan);
    assignments.set(`${mode}:${direction}`,changed.replacementAssignmentId);
  });
  it.each(reviewedFixtureModes)("%s %s reaches the real 20-session bulk writer without dates",async(mode,direction)=>{
    const {units,questions}=await targets(mode,direction,20);
    let offset=0;
    const batches=fixture.bundle.units.map((unit,i)=>{
      const list=questions.slice(offset,offset+unit.entry_count).map((q,n)=>({...q,base_order_index:n+1}));offset+=unit.entry_count;
      return {kind:"regular",student_id:id(3),dataset_id:datasetId,unit_ids:[units[i]],unit_labels:[unit.label],title:`가짜 회차 ${i+1}`,
        question_count:list.length,english_to_korean_ratio:direction==="english_to_korean"?100:0,time_limit_seconds:300,passing_score:80,
        retry_enabled:true,retry_passing_score:80,question_order_mode:"fixed",available_from:null,available_until:null,
        timing_mode:"none",question_time_limit_seconds:null,session_number:i+1,session_count:20,questions:list};
    });
    const key=id(600+reviewedFixtureModes.findIndex(([m,d])=>m===mode&&d===direction));
    const created=await scalar<{assignment_id:string;status:string}[]>("select public.create_bulk_vocab_assignments_v11($1::uuid,$2,$3::jsonb) value",[key,"b".repeat(64),JSON.stringify(batches)]);
    expect(created).toHaveLength(20);
    const counts=(await db.query<{question_count:number}>("select question_count from public.assignments where id=any($1)",[created.map(r=>r.assignment_id)])).rows;
    expect(counts.reduce((n,r)=>n+r.question_count,0)).toBe(278);
    const replay=await scalar("select public.create_bulk_vocab_assignments_v11($1::uuid,$2,$3::jsonb) value",[key,"b".repeat(64),JSON.stringify(batches)]);
    expect(replay).toEqual(created);
  });
  it.each(reviewedFixtureModes)("%s %s starts and grades through the actual student RPCs",async(mode,direction)=>{
    const {units,questions}=await targets(mode,direction);
    const assignment=await create(mode,direction,questions,units);
    const attempt=await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value",[id(2),assignment]);
    const first=(await db.query<{id:string;correct_choice_index:number}>("select id,correct_choice_index from public.quiz_questions where attempt_id=$1 order by order_index limit 1",[attempt])).rows[0];
    const answer=await scalar<Record<string,unknown>>("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4,false) value",[id(2),attempt,first.id,first.correct_choice_index]);
    expect(answer.correct).toBe(true);
    await expect(db.query("select public.answer_quiz_question_v4($1,$2,$3,'initial',0,false)",[id(3),attempt,first.id])).rejects.toThrow();
  });
  it.each(reviewedFixtureModes)("%s %s uses the dated completion queue without changing its item proof",async(mode,direction)=>{
    const {units,questions}=await targets(mode,direction,2);
    let offset=0;
    const items=fixture.bundle.units.slice(0,2).map((unit,i)=>{
      const list=questions.slice(offset,offset+unit.entry_count).map((q,n)=>({...q,base_order_index:n+1}));offset+=unit.entry_count;
      return {kind:"regular",student_id:id(3),dataset_id:datasetId,unit_ids:[units[i]],unit_labels:[unit.label],title:`가짜 날짜 시험 ${i+1}`,question_count:list.length,english_to_korean_ratio:direction==="english_to_korean"?100:0,time_limit_seconds:300,passing_score:80,retry_enabled:true,retry_passing_score:80,question_order_mode:"fixed",available_from:`2030-01-0${i+1}T00:00:00.000Z`,available_until:`2030-01-0${i+1}T14:00:00.000Z`,timing_mode:"none",question_time_limit_seconds:null,session_number:i+1,session_count:2,questions:list};
    });
    const payload=[{student_id:id(3),dataset_id:datasetId,dataset_label:"가짜 자료",range_label:"가짜 지문 1~2",split_basis:"range_unit",resolved_plan_sha256:"e".repeat(64),recurrence_slots:[{isodow:2,local_time:"09:00:00",duration_seconds:50400},{isodow:3,local_time:"09:00:00",duration_seconds:50400}],allocation_rule:{schema_version:1,mode:"same",units_per_session:1,weekday_units_per_session:Array.from({length:7},(_,i)=>({isodow:i+1,unit_count:1})),base_session_unit_counts:[1,1],ordered_unit_ids:units,overflow_policy:"leave",extra_date_policy:"unconfirmed"},items}];
    const key=id(700+reviewedFixtureModes.findIndex(([m,d])=>m===mode&&d===direction));
    const created=await scalar<{assignment_id:string|null;status:string}[]>("select public.create_vocab_assignment_queues_v3($1,$2,$3::jsonb) value",[key,"e".repeat(64),JSON.stringify(payload)]);
    expect(created.map(x=>x.status)).toEqual(["assigned","queued"]);
    expect(await scalar("select provenance_status value from public.assignments where id=$1",[created[0].assignment_id])).toBe("exam_reviewed_v1");
  });
  it.each([true,false])("blocks a second correct choice even when its own question is not selected (%s)",async includeOther=>{
    const {units,questions}=await targets("canonical_definition_to_headword","korean_to_english");
    await db.exec("begin");
    try {
      await db.query("update private.reviewed_exam_items set prompt=(select prompt from private.reviewed_exam_items where release_id=$1 and item_id=$2) where release_id=$1 and item_id=$3",[releaseId,questions[0].reviewed_bank.question_item_id,questions[1].reviewed_bank.question_item_id]);
      const selected=includeOther?questions:[questions[0],...questions.slice(2,5)].map((q,i)=>({...q,base_order_index:i+1}));
      await expect(create("canonical_definition_to_headword","korean_to_english",selected,units)).rejects.toMatchObject({code:"22023",message:"assignment_target_prompt_ambiguous"});
    } finally {await db.exec("rollback");}
  });
  it("preserves a genuine shared gloss when each reviewed question has only one matching choice",async()=>{
    const {units,questions}=await targets("book_meaning_choice","korean_to_english");
    await db.exec("begin");
    try {
      for(const [index,choices] of [[0,["alpha","fake-one","fake-two","fake-three"]],[1,["fake-four","beta","fake-five","fake-six"]]] as const){
        await db.query("update private.reviewed_exam_items set prompt='shared fake gloss',choice_texts=$3 where release_id=$1 and item_id=$2",[releaseId,questions[index].reviewed_bank.question_item_id,choices]);
      }
      const assignment=await create("book_meaning_choice","korean_to_english",questions,units);
      expect(await scalar("select count(*)::int value from public.assignment_questions where assignment_id=$1 and prompt='shared fake gloss'",[assignment])).toBe(2);
    } finally {await db.exec("rollback");}
  });
  it.each([" ALPHA ","ａｌｐｈａ","alpha"])("rejects choices differing only by case, width or spaces (%s)",async duplicate=>{
    const {units,questions}=await targets("book_meaning_choice","korean_to_english");
    await db.exec("begin");
    try {
      await db.query("update private.reviewed_exam_items set choice_texts=$3 where release_id=$1 and item_id=$2",[releaseId,questions[0].reviewed_bank.question_item_id,["alpha",duplicate,"beta","gamma"]]);
      await expect(create("book_meaning_choice","korean_to_english",questions,units)).rejects.toMatchObject({code:"22023",message:"assignment_target_choices_duplicate"});
    } finally {await db.exec("rollback");}
  });
  it("keeps assigned audio after retirement but refuses new assignments",async()=>{
    const {units,questions}=await targets("book_meaning_choice","english_to_korean");
    await db.exec("begin");
    try {
      await db.query("update private.reviewed_exam_releases set status='retired' where release_id=$1",[releaseId]);
      const audio=await db.query("select * from public.list_active_vocab_pronunciation_bindings_v3($1)",[questions.map(q=>q.vocab_entry_id)]);
      expect(audio.rows).toHaveLength(12);
      await expect(create("book_meaning_choice","english_to_korean",questions,units)).rejects.toMatchObject({code:"55000",message:"reviewed_exam_release_unavailable"});
    } finally { await db.exec("rollback"); }
  });
});
