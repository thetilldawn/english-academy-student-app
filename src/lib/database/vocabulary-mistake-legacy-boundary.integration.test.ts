import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
const id=(n:number)=>`a3060000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const admin=id(1),dataset=id(4),unit=id(5);
let db:PGlite,oldAssignment:string,scopeId:string,oldRows:unknown,oldScope:unknown;
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

async function seed(){await db.exec(`begin;
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
      commit;`);}
async function ordinarySource(){    await db.exec(`update public.students set school_name='Fake school',grade_label='고2' where id='${id(2)}';
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
}
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

async function ordinaryBank(){
  const entries=await rows<{id:number;source_row:number}>("select id,source_row from vocab_entries where dataset_id=$1 order by source_row",[dataset]);
  const plan=entries.map(e=>({vocab_entry_id:e.id,base_order_index:e.source_row,direction:"english_to_korean",choice_vocab_entry_ids:entries.map(x=>x.id)}));
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated`);
  const assignment=(await rows<{id:string}>(`select public.create_assignment_with_delivery_v7('가짜 경계검사',$1,array[$2]::uuid[],4,100::smallint,300,80::smallint,false,null::smallint,'fixed',null,array[$3]::uuid[],'none',null,$4) id`,[dataset,unit,id(2),JSON.stringify(plan)]))[0].id;
  await db.exec("reset role");return assignment;
}
const bankRows=(assignment:string)=>rows("select to_jsonb(q)-'content_version_id' value from assignment_questions q where assignment_id=$1 order by base_order_index",[assignment]);
const scopeRows=()=>rows("select to_jsonb(s) value from private.vocabulary_library_scope_rows s where scope_id=$1 order by source_row",[scopeId]);
const identities=(assignment:string)=>rows<{id:string;value:{meaningKey:string;sourceBinding?:unknown}}>("select q.id,private.assignment_vocabulary_meaning_v1(q.id) value from assignment_questions q where assignment_id=$1 order by base_order_index",[assignment]);
beforeAll(async()=>{
  db=await createFinalSchemaDatabase({beforeMigration:async(database,name)=>{
    if(name!=="20261001132340_compact_vocabulary_learning_values.sql")return;
    db=database;await seed();await db.exec("begin");await ordinarySource();
    scopeId=await importRawMeaningScope();oldAssignment=await ordinaryBank();
    oldRows=await bankRows(oldAssignment);oldScope=await scopeRows();await db.exec("reset role;commit");
  }});
},120_000);
afterAll(async()=>{await db?.close();});

describe.sequential("M01 이전 원고와 문항의 뜻 고정 경계",()=>{
  it("기존 원고·문항은 그대로 두고 뒤에 생긴 연결은 신규 문항에서만 쓴다",async()=>{
    await db.exec("begin");
    try {
      expect(await bankRows(oldAssignment)).toEqual(oldRows);expect(await scopeRows()).toEqual(oldScope);
      expect(await rows("select count(*)::int n from private.vocabulary_learning_value_bindings")).toEqual([{n:0}]);
      expect(await rows("select count(*)::int n from private.assignment_vocabulary_meaning_refs")).toEqual([{n:0}]);
      expect(await rows("select count(*)::int n from private.assignment_vocabulary_new_questions")).toEqual([{n:0}]);
      const oldIdentities=await identities(oldAssignment),beforeBinding=await ordinaryBank(),beforeIdentities=await identities(beforeBinding);
      expect(oldIdentities.every(item=>!item.value.sourceBinding)).toBe(true);expect(beforeIdentities.every(item=>!item.value.sourceBinding)).toBe(true);
      await rows("select private.vocabulary_composition_row_document_v2($1,r.occurrence_key,array[$1]::uuid[]) from private.vocabulary_library_scope_rows r where scope_id=$1 offset 0",[scopeId]);
      expect(await rows("select count(*)::int n from private.vocabulary_learning_value_bindings")).toEqual([{n:4}]);
      const fresh=await ordinaryBank();
      const adopted=await rows(`select mi.value#>>'{sourceBinding,bindingId}'=b.binding_id::text binding_equal,
        mi.value->>'meaningKey'=b.payload#>>'{learningIdentity,key}' meaning_equal,
        b.payload#>>'{source,version}' source_version,b.payload#>>'{source,fileHash}' file_hash,
        b.payload#>>'{originalHashes,entrySnapshotHash}'=private.reviewed_exam_sha256_v1(to_jsonb(e)) entry_exact
        from assignment_questions q join vocab_entries e on e.id=q.vocab_entry_id
        join private.vocabulary_learning_value_bindings b on b.payload#>>'{entryLink,id}'=e.id::text
        cross join lateral(select private.assignment_vocabulary_meaning_v1(q.id) value) mi where assignment_id=$1 order by base_order_index`,[fresh]);
      expect(adopted).toEqual(Array.from({length:4},()=>({binding_equal:true,meaning_equal:true,source_version:"a".repeat(64),file_hash:"e".repeat(64),entry_exact:true})));
      await rows("update assignment_questions set base_order_index=base_order_index where assignment_id=any($1::uuid[])",[[oldAssignment,beforeBinding]]);
      await rows("select private.finalize_assignment_question_body_refs_v1($1)",[oldAssignment]);
      expect(await identities(oldAssignment)).toEqual(oldIdentities);expect(await identities(beforeBinding)).toEqual(beforeIdentities);
      expect(await rows("select to_jsonb(q)-'content_version_id' value from private.assignment_question_contents_v1 q where assignment_id=$1 order by base_order_index",[oldAssignment])).toEqual(oldRows);
      expect(await scopeRows()).toEqual(oldScope);
      await db.exec("grant usage on schema auth,extensions to service_role;alter role service_role bypassrls");
      const attempt=(await service<{value:string}>("select public.create_quiz_attempt_from_bank($1,$2) value",[id(2),oldAssignment]))[0].value;
      const question=(await rows<{id:string;correct_choice_index:number}>("select id,correct_choice_index from quiz_questions where attempt_id=$1 order by order_index limit 1",[attempt]))[0];
      await service("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false)",[id(2),attempt,question.id,(question.correct_choice_index+1)%4]);
      const page=(await service<{value:{items:{meanings:{meaningKey:string}[]}[]}}>("select public.get_student_vocabulary_mistake_page_v1($1,'{}',null) value",[id(2)]))[0].value;
      expect(page.items[0].meanings[0].meaningKey).toBe(oldIdentities[0].value.meaningKey);
      expect(page.items[0].meanings[0].meaningKey).not.toBe((await identities(fresh))[0].value.meaningKey);
    }finally{await db.exec("rollback;reset role");}
  });
  it("애플리케이션 역할은 생성 표시와 내부 뜻 채택 함수를 열 수 없다",async()=>{
    await db.exec("begin");
    try{
      for(const role of ["anon","authenticated","service_role"]){
        expect(await rows(`select has_table_privilege($1,'private.assignment_vocabulary_new_questions','SELECT,INSERT,UPDATE,DELETE') marker,
          has_function_privilege($1,'private.mark_new_vocabulary_question_v1()','EXECUTE') mark,
          has_function_privilege($1,'private.expire_new_vocabulary_question_marker_v1()','EXECUTE') expire,
          has_function_privilege($1,'private.new_raw_vocabulary_learning_binding_v1(uuid)','EXECUTE') adopt,
          has_function_privilege($1,'private.freeze_assignment_vocabulary_meanings_v1(uuid)','EXECUTE') freeze`,[role]))
          .toEqual([{marker:false,mark:false,expire:false,adopt:false,freeze:false}]);
        for(const sql of ["select * from private.assignment_vocabulary_new_questions",
          "insert into private.assignment_vocabulary_new_questions select * from private.assignment_vocabulary_new_questions",
          `select private.new_raw_vocabulary_learning_binding_v1('${id(900)}')`])
          await fails(async()=>{await db.exec(`set local role ${role}`);return rows(sql);},"permission denied");
      }
      expect(await ordinaryBank()).toEqual(expect.any(String));
    }finally{await db.exec("rollback;reset role");}
  });
  it("미완성 INSERT 표시는 커밋·롤백에 남지 않으며 정상 확정은 즉시 소비한다",async()=>{
    const previous=db;db=await createFinalSchemaDatabase();
    try{
      await seed();await db.exec("begin");const first=await seedBank(50);
      expect(await rows(`select count(*)::int n,bool_and(backend_pid=pg_backend_pid() and transaction_id=txid_current()) own
        from private.assignment_vocabulary_new_questions where assignment_question_id in(select id from assignment_questions where assignment_id=$1)`,[first]))
        .toEqual([{n:4,own:true}]);
      await db.exec("commit");expect(await rows("select count(*)::int n from private.assignment_vocabulary_new_questions")).toEqual([{n:0}]);
      expect(await rows("select count(*)::int n from assignment_questions where assignment_id=$1",[first])).toEqual([{n:4}]);
      await db.exec("begin");const second=await seedBank(51);await db.exec("rollback");
      expect(await rows("select count(*)::int n from assignment_questions where assignment_id=$1",[second])).toEqual([{n:0}]);
      await db.exec("begin");const third=await seedBank(52);await rows("select private.finalize_assignment_question_body_refs_v1($1)",[third]);
      expect(await rows("select count(*)::int n from private.assignment_vocabulary_new_questions")).toEqual([{n:0}]);await db.exec("commit");
    }finally{await db.close();db=previous;}
  },120_000);
});
