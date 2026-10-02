import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const id = (n: number) => `a2020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), dataset = id(4), unit = id(5);

describe.sequential("frozen question content: actual storage constraints", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`begin;
      select set_config('request.jwt.claim.sub','${admin}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      insert into auth.users(id) values('${admin}');
      insert into public.admin_profiles(user_id,display_name,is_active) values('${admin}','Fake content admin',true);
      insert into public.students(id,display_name,status,created_by) values('${id(2)}','Fake content student','active','${admin}');
      insert into public.students(id,display_name,status,created_by) values('${id(3)}','Fake other student','active','${admin}');
      insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${dataset}','m02-fake-core','Fake content','Fake',repeat('A',64),4,'ready','${admin}');
      insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${unit}','${dataset}','DAY 1','day 1','day',1,1,4);
      insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
        select '${dataset}',n,'frozen'||n,'frozen'||n,array['고정 뜻'||n],'고정 뜻'||n,repeat('B',63)||n::text,'${unit}',n,'word' from generate_series(1,4)n;
      commit;`);
  }, 120_000);
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback; reset role"); });
  afterAll(async () => { await db?.close(); });
  async function rows<T = Record<string, unknown>>(query: string, args: unknown[] = []) {
    return (await db.query<T>(query, args)).rows;
  }
  async function fails(action: () => Promise<unknown>, message: string) {
    await db.exec("savepoint expected_failure");
    try { await expect(action()).rejects.toThrow(message); }
    finally { await db.exec("rollback to expected_failure; release expected_failure"); }
  }
  async function service<T>(query: string, args: unknown[]) {
    await db.exec("select set_config('request.jwt.claim.role','service_role',true); set local role service_role");
    const result = await rows<T>(query, args);
    await db.exec("reset role");
    return result;
  }
  async function importRawMeaningScope() {
    await db.exec("reset role");
    const meta=(await rows<{version:string;file_hash:string}>(`select lower(d.source_sha256) version,lower(s.source_sha256) file_hash
      from public.vocab_datasets d join word_index.dataset_source ds on ds.dataset_id=d.id join word_index.source s on s.source_id=ds.source_id
      where d.id=$1 and s.source_id=$2`,[dataset,id(41)]))[0];
    const sourceRows=await rows<{source_row:number;row_hash:string}>("select source_row,lower(row_sha256) row_hash from vocab_entries where dataset_id=$1 order by source_row",[dataset]);
    const selected={schemaVersion:"vocabulary-resource-snapshot-v1",sourceFields:{},proofs:{},
      pronunciation:{displayKo:null,variantId:null,audioUrl:null,available:false},lexicalPos:null,dictionary:null,senseId:null,definitionEn:null,exampleEn:null,exampleKo:null};
    const input=JSON.stringify({schemaVersion:"vocabulary-library-import-v1",sourceCatalogHash:"b".repeat(64),linksHash:"c".repeat(64),referenceCatalogHash:"d".repeat(64),
      scopes:[{key:"m03-raw-positive",name:"가짜 일반 출제 범위",sourceTitle:"가짜 일반 단어장",
        source:{datasetId:dataset,unitId:unit,kind:"legacy_vocab",releaseId:null,releaseVersion:meta.version,fileHash:meta.file_hash,locator:"fake-ordinary.json"},
        classification:{kind:"wordbook",sourceGrade:"g11",exam:null,lesson:null,day:1,publisher:null,school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:null},
        rows:sourceRows.map(r=>({sourceRow:r.source_row,rowHash:r.row_hash,resources:{entryHash:r.row_hash,linkRecordHash:"f".repeat(64),selected}}))}]});
    const project="wojxpruvbjzbhrpmsbuy";
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({ref:project})]);
    await db.query(`insert into private.vocabulary_library_import_approvals(target_project_ref,file_sha256,content_sha256,scope_count,approval_id)
      values($1,encode(extensions.digest(convert_to($2::text,'UTF8'),'sha256'),'hex'),private.reviewed_exam_sha256_v1($2::jsonb),1,'fake-m03-raw-positive')`,[project,input]);
    return (await service<{value:{scopes:{id:string}[]}}>("select public.import_vocabulary_library_v1($1) value",[input]))[0].value.scopes[0].id;
  }
  // This intentionally seeds legacy-shaped rows to isolate storage guards. It
  // is not evidence for a public assignment creator or its approval checks.
  async function seedBank(n: number) {
    const assignment = id(n);
    await db.query(`insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,
      timing_mode,passing_score,status,created_by,retake_allowed,range_basis,question_bank_version)
      values($1,'Fake frozen exam',$2,1,4,4,100,240,'none',80,'active',$3,true,'units',1)`, [assignment, dataset, admin]);
    await db.query("insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values($1,$2,$3,1,true)", [assignment, dataset, unit]);
    await db.query("insert into public.assignment_students(assignment_id,student_id,assigned_by) values($1,$2,$3)", [assignment, id(2), admin]);
    await db.query(`insert into public.assignment_questions(assignment_id,dataset_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,
      headword_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids)
      select $1,$2,e.id,e.source_row,'english_to_korean',e.headword,
      (select jsonb_agg(primary_meaning order by source_row) from public.vocab_entries where dataset_id=$2),(e.source_row-1)::smallint,
      e.headword,e.primary_meaning,(select array_agg(id order by source_row) from public.vocab_entries where dataset_id=$2)
      from public.vocab_entries e where e.dataset_id=$2`, [assignment, dataset]);
    return assignment;
  }
  it("uses the real ordinary v2 creator after actual link finalization, retaining its source checks", async () => {
    await db.exec(`update public.students set school_name='Fake school',grade_label='고2' where id='${id(2)}';
      insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,is_assignable)
      values('${dataset}','Fake ordinary book','high','wordbook',true);
      insert into word_index.index_build(build_id,schema_version,builder_version,source_root_label,input_file_count,input_snapshot_sha256,started_at_utc,completed_at_utc,status,summary_json)
        values('${id(40)}','fixture','fixture','fake',1,repeat('B',64),now(),now(),'complete','{}');
      insert into word_index.source(source_id,source_key,source_type,title,source_sha256,status)
        values('${id(41)}','fake-m02-ordinary','wordbook','Fake source',repeat('E',64),'ready');
      insert into word_index.dataset_source(dataset_id,source_id,build_id,source_role,dataset_source_sha256)
        values('${dataset}','${id(41)}','${id(40)}','primary',repeat('A',64));
      insert into word_index.vocab_entry_link(vocab_entry_id,dataset_id,entry_row_sha256,source_id,mapping_status,mapping_method,mapping_rule_version,candidate_count,evidence,mapped_at_utc)
        select id,dataset_id,row_sha256,'${id(41)}','unresolved','fixture','fixture',0,'{}',now() from public.vocab_entries where dataset_id='${dataset}';
      insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,reason_codes,input_content_hash,rule_version,evaluated_at_utc)
        select id,dataset_id,'book_meaning_en_to_ko','eligible','{}',row_sha256,'fixture',now() from public.vocab_entries where dataset_id='${dataset}';
      insert into word_index.vocab_link_import_run(dataset_id,source_id,build_id,package_snapshot_sha256,source_payload_sha256,status,expected_counts)
        values('${dataset}','${id(41)}','${id(40)}',repeat('C',64),repeat('D',64),'loading',
        '{"occurrence":0,"vocab_entry_link":4,"vocab_entry_mapping_candidate":0,"vocab_entry_quiz_eligibility":4,"vocab_dataset_capabilities":1}');`);
    await service("select public.finalize_vocab_link_import($1,$2)",[dataset,JSON.stringify([{
      dataset_id:dataset,quiz_mode:'book_meaning_en_to_ko',status:'ready',eligible_entry_count:4,excluded_entry_count:0,
      reason_code:'all_entries_eligible',dataset_source_sha256:'A'.repeat(64),canonical_snapshot_sha256:'B'.repeat(64),
      rule_version:'fixture',evaluated_at_utc:new Date().toISOString(),details:{packageSnapshotSha256:'C'.repeat(64)},
    }])]);
    expect((await rows("select status,capabilities_payload_sha256 is not null hashed from word_index.vocab_link_import_run where dataset_id=$1",[dataset]))[0]).toEqual({status:'complete',hashed:true});
    const scopeId=await importRawMeaningScope();
    const entries=await rows<{id:number;source_row:number}>('select id,source_row from public.vocab_entries where dataset_id=$1 order by source_row',[dataset]);
    const plan=entries.map(e=>({vocab_entry_id:e.id,base_order_index:e.source_row,direction:'english_to_korean',choice_vocab_entry_ids:entries.map(x=>x.id)}));
    await db.exec(`select set_config('request.jwt.claim.sub','${admin}',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated`);
    const create=()=>rows<{id:string}>(`select public.create_assignment_with_delivery_v7('Fake ordinary exam',$1,array[$2]::uuid[],4,100::smallint,300,80::smallint,false,null::smallint,'fixed',null,array[$3]::uuid[],'none',null,$4) id`,[dataset,unit,id(2),JSON.stringify(plan)]);
    const assignment=(await create())[0].id;
    await db.exec('reset role');
    const linked=await rows(`select sr.resources#>>'{selected,schemaVersion}' storage_version,
      sr.entry_snapshot=private.compact_vocabulary_source_snapshot_v1(to_jsonb(e),'entry') entry_exact,
      b.payload#>>'{originalHashes,entrySnapshotHash}'=private.reviewed_exam_sha256_v1(to_jsonb(e)) original_hash_exact,
      mi.value->>'identityKind' identity_kind,mi.value->>'meaningKey'=b.payload#>>'{learningIdentity,key}' meaning_equal,
      mi.value#>>'{sourceBinding,bindingId}'=b.binding_id::text binding_equal,
      b.payload#>>'{source,version}' source_version,b.payload#>>'{source,fileHash}' file_hash
      from public.assignment_questions q join public.vocab_entries e on e.id=q.vocab_entry_id
      join private.vocabulary_library_scope_rows sr on sr.scope_id=$2 and sr.source_entry_id=e.id
      join private.vocabulary_learning_value_bindings b on b.binding_id::text=sr.resources#>>'{selectionBinding,bindingId}'
        and b.binding_sha256=sr.resources#>>'{selectionBinding,bindingHash}'
      cross join lateral(select private.assignment_vocabulary_meaning_v1(q.id) value) mi
      where q.assignment_id=$1 order by q.base_order_index`,[assignment,scopeId]);
    expect(linked).toEqual(Array.from({length:4},()=>({storage_version:"vocabulary-resource-ref-v2",entry_exact:true,original_hash_exact:true,
      identity_kind:"source-occurrence-v1",meaning_equal:true,binding_equal:true,source_version:"a".repeat(64),file_hash:"e".repeat(64)})));
    expect((await rows('select question_bank_version,provenance_status,generator_version from public.assignments where id=$1',[assignment]))[0])
      .toEqual({question_bank_version:2,provenance_status:'verified_v2',generator_version:'book-choice-cache-v2'});
    expect((await rows('select count(*)::int n from public.assignment_questions where assignment_id=$1 and content_version_id is not null and prompt is null and choices is null',[assignment]))[0].n).toBe(4);
    expect(await rows('select prompt,choices,correct_choice_index from private.assignment_question_contents_v1 where assignment_id=$1 order by base_order_index',[assignment]))
      .toEqual(entries.map((e,i)=>({prompt:'frozen'+e.source_row,choices:['고정 뜻1','고정 뜻2','고정 뜻3','고정 뜻4'],correct_choice_index:i})));
    await db.query("update word_index.vocab_entry_link set entry_row_sha256=repeat('F',64) where dataset_id=$1",[dataset]);
    const before=await rows('select id from public.assignments order by id');
    await db.exec('set local role authenticated');
    await fails(create,'question_not_eligible_for_direction');
    await db.exec('reset role');
    expect(await rows('select id from public.assignments order by id')).toEqual(before);
  });
  it("shares identical bodies across different assignments and restores exact historical fields", async () => {
    const first = await seedBank(10), second = await seedBank(11);
    const before = await rows("select to_jsonb(q)-'content_version_id' value from public.assignment_questions q order by id");
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [first]);
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [second]);
    expect((await rows("select count(*)::int n from private.vocabulary_question_content_versions"))[0].n).toBe(4);
    expect((await rows("select count(*)::int n from public.assignment_questions where prompt is null and choices is null and content_version_id is not null"))[0].n).toBe(8);
    expect(await rows("select to_jsonb(q)-'content_version_id' value from private.assignment_question_contents_v1 q order by id")).toEqual(before);
    expect((await rows("select count(*)::int n from private.vocabulary_question_content_versions where binding ?| array['assignment_id','student_id','base_order_index','question_content_sha256','created_at']"))[0].n).toBe(0);
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [first]);
    expect((await rows("select count(*)::int n from private.vocabulary_question_content_versions"))[0].n).toBe(4);
  });
  it("retains original body validation and rejects reference substitution or frozen body edits", async () => {
    const assignment = await seedBank(10);
    await fails(() => db.query("update public.assignment_questions set choices='[]' where assignment_id=$1", [assignment]), "question_body_constraint_violation");
    await fails(() => db.query("update public.assignment_questions set prompt=null where assignment_id=$1", [assignment]), "question_body_not_null");
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [assignment]);
    await fails(() => db.query("update public.assignment_questions set prompt='changed' where assignment_id=$1", [assignment]), "question_content_reference_immutable");
    await fails(() => db.query("update public.assignment_questions set content_version_id=null where assignment_id=$1", [assignment]), "question_content_reference_immutable");
    const question = (await rows<{ value: Record<string, unknown> }>("select to_jsonb(q) value from public.assignment_questions q where assignment_id=$1 order by base_order_index limit 1", [assignment]))[0].value;
    await fails(() => db.query("select private.resolve_assignment_question_content_v1(jsonb_populate_record(null::public.assignment_questions,$1::jsonb))", [{ ...question, correct_choice_index: 3 }]), "question_content_binding_mismatch");
    await fails(() => db.query("update private.vocabulary_question_content_versions set payload=payload||'{\"prompt\":\"changed\"}'"), "immutable");
  });
  it("keeps old rows readable and does not resolve a valid reference against the latest dictionary", async () => {
    const first = await seedBank(10), second = await seedBank(11);
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [first]);
    const expected = await rows("select prompt,choices,headword_snapshot,primary_meaning_snapshot from private.assignment_question_contents_v1 where assignment_id=$1 order by base_order_index", [first]);
    await db.query("update public.vocab_entries set headword='later'||source_row,primary_meaning='나중 뜻'||source_row where dataset_id=$1", [dataset]);
    expect(await rows("select prompt,choices,headword_snapshot,primary_meaning_snapshot from private.assignment_question_contents_v1 where assignment_id=$1 order by base_order_index", [first])).toEqual(expected);
    expect(await rows("select prompt,choices,headword_snapshot,primary_meaning_snapshot from private.assignment_question_contents_v1 where assignment_id=$1 order by base_order_index", [second])).toEqual(expected);
    expect((await rows("select count(*)::int n from public.assignment_questions where content_version_id is null"))[0].n).toBe(4);
  });
  it("denies direct access to the content and internal reconstruction relation for browser and service roles", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await fails(async () => { await db.exec(`set local role ${role}`); return db.query("select * from private.vocabulary_question_content_versions"); }, "permission denied");
      await fails(async () => { await db.exec(`set local role ${role}`); return db.query("select * from private.assignment_question_contents_v1"); }, "permission denied");
    }
  });
  it("cannot attach a same-key reference with different historical text to an inline bank", async () => {
    const first = await seedBank(10), second = await seedBank(11);
    await db.query("update public.assignment_questions set prompt='different historical prompt' where assignment_id=$1 and base_order_index=1", [second]);
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [first]);
    const attempt = (await service<{ id: string }>("select public.create_quiz_attempt_from_bank($1,$2) id", [id(2), second]))[0].id;
    await fails(() => db.query(`insert into public.quiz_questions(attempt_id,assignment_question_id,vocab_entry_id,order_index,direction,correct_choice_index,content_version_id)
      select $1,b.id,b.vocab_entry_id,5,b.direction,b.correct_choice_index,a.content_version_id
      from public.assignment_questions a join public.assignment_questions b on b.vocab_entry_id=a.vocab_entry_id
      where a.assignment_id=$2 and b.assignment_id=$3 and b.base_order_index=1`, [attempt, first, second]), "question_content_body_mismatch");
  });
  it("reads only the requested owned questions and keeps old attempts available after assignment closure", async () => {
    const assignment = await seedBank(10);
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [assignment]);
    const attempt = (await service<{ id: string }>("select public.create_quiz_attempt_from_bank($1,$2) id", [id(2), assignment]))[0].id;
    const ids = (await rows<{ id: string }>("select id from public.quiz_questions where attempt_id=$1 order by order_index", [attempt])).map(r => r.id);
    const sql = "select public.read_question_contents_v1($1,$2,$3,$4) value";
    const read = async (context: string, actor: string, contextId: string, questions = ids) => (await service<{ value: {items: Array<Record<string, unknown>>} }>(sql, [context, actor, contextId, questions]))[0].value;
    const value = await read("student_attempt", id(2), attempt);
    expect(value.items).toHaveLength(4);
    expect(value.items[0]).toMatchObject({ id: ids[0], prompt: expect.stringMatching(/^frozen[1-4]$/), choices: ["고정 뜻1", "고정 뜻2", "고정 뜻3", "고정 뜻4"] });
    expect(JSON.stringify(value)).not.toMatch(/content_version_id|correct_choice_index|student_id|started_at/);
    await fails(() => read("student_attempt", id(3), attempt), "question_not_owned");
    await fails(() => read("student_attempt", id(2), attempt, [ids[0], id(999)]), "question_not_owned");
    await fails(() => read("student_attempt", id(2), attempt, [ids[0], ids[0]]), "question_content_request_invalid");
    await fails(() => read("admin_attempt", id(3), attempt), "admin_required");
    await db.query("update public.assignments set status='closed' where id=$1", [assignment]);
    expect(await read("student_attempt", id(2), attempt)).toEqual(value);
    await db.query("update public.students set status='blocked' where id=$1", [id(2)]);
    expect((await read("admin_attempt", admin, attempt)).items).toEqual(value.items);
    await fails(() => read("student_attempt", id(2), attempt), "student_not_found");
  });
  it("preparation content is limited to the frozen plan, not merely another question of the same assignment", async () => {
    const assignment = await seedBank(10);
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [assignment]);
    const prep = (await service<{ id: string }>("select public.prepare_quiz_attempt_v1($1,$2,null) id", [id(2), assignment]))[0].id;
    const ids = (await rows<{ id: string }>("select id from public.assignment_questions where assignment_id=$1 order by base_order_index", [assignment])).map(r => r.id);
    const sql = "select public.read_question_contents_v1('student_preparation',$1,$2,$3) value";
    const value = (await service<{ value: { items: unknown[] } }>(sql, [id(2), prep, ids])).at(0)!.value;
    expect(value.items).toHaveLength(4);
    // Preserve the stored v2 receipt; create a separate old-format receipt whose
    // valid fingerprint covers this assignment but whose plan has one item only.
    const limited = (await db.query<{ id: string }>(`insert into private.quiz_attempt_preparations(student_id,assignment_id,kind,request_key,fingerprint,plan)
      select student_id,assignment_id,kind,'limited-fake-plan',fingerprint,jsonb_build_array(private.resolve_quiz_preparation_plan_v2(p)->0)
      from private.quiz_attempt_preparations p where id=$1 returning id`, [prep])).rows[0].id;
    const included=(await rows<{id:string}>("select plan->0->>'assignment_question_id' id from private.quiz_attempt_preparations where id=$1",[limited]))[0].id;
    await fails(() => service(sql, [id(2), limited, [ids.find(value=>value!==included)!]]), "question_not_owned");
  });
});
