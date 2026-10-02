import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { mistakePracticeSourceSchema } from "@/features/quiz-player/domain/mistake-practice-plan";
const id=(n:number)=>`a3070000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const admin=id(1),student=id(2),dataset=id(4),unit=id(5);
let db:PGlite;
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
async function ordinarySource(count=4){    await db.exec(`update public.students set school_name='Fake school',grade_label='고2' where id='${id(2)}';
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
        select e.id,e.dataset_id,m.quiz_mode,'eligible','{}',e.row_sha256,'fixture',now() from public.vocab_entries e cross join (values('book_meaning_en_to_ko'),('book_meaning_ko_to_en')) m(quiz_mode) where e.dataset_id='${dataset}';
      insert into word_index.vocab_link_import_run(dataset_id,source_id,build_id,package_snapshot_sha256,source_payload_sha256,status,expected_counts)
        values('${dataset}','${id(41)}','${id(40)}',repeat('C',64),repeat('D',64),'loading',
        '{"occurrence":0,"vocab_entry_link":${count},"vocab_entry_mapping_candidate":0,"vocab_entry_quiz_eligibility":${count*2},"vocab_dataset_capabilities":2}');`);
    await service("select public.finalize_vocab_link_import($1,$2)",[dataset,JSON.stringify(["book_meaning_en_to_ko","book_meaning_ko_to_en"].map(quizMode=>({
      dataset_id:dataset,quiz_mode:quizMode,status:'ready',eligible_entry_count:count,excluded_entry_count:0,
      reason_code:'all_entries_eligible',dataset_source_sha256:'A'.repeat(64),canonical_snapshot_sha256:'B'.repeat(64),
      rule_version:'fixture',evaluated_at_utc:new Date().toISOString(),details:{packageSnapshotSha256:'C'.repeat(64)},
    }))) ]);
}
  async function seedRelease(source: string, release: string, approved = true) {
    await db.query(`insert into word_index.app_exam_use_release(release_id,release_key,dataset_id,dataset_key,schema_version,
      package_version,source_sha256,candidate_dictionary_version,manifest_content_hash,exam_review_ledger_sha256,wordbook_id,title,target_environment,
      common_dictionary_release_allowed,exam_use_import_allowed,expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json)
      select $2::uuid,'m03-fake:'||$2::text,d.id,d.dataset_key,'1.0',encode(extensions.digest($2::text,'sha256'),'hex'),d.source_sha256,repeat('a',64),repeat('b',64),repeat('c',64),
      'm03-fake','가짜 뜻 승인 검사','preview',false,true,4,4,4,'active','{}' from vocab_datasets d where d.id=$1`, [source, release]);
    await db.query(`insert into word_index.app_exam_use_occurrence(release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,
      dictionary_id,sense_id,display_headword,display_gloss_ko,display_pronunciation_review_status,audio_status,listening_enabled,
      occurrence_id,occurrence_content_hash,package_entry_content_hash,exam_review_id,exam_input_hash,exam_use_status,context_evidence_status,context_evidence,
      source_projection_row_sha256,source_entry_id,source_entry_sha256,include_in_exam,audio_json,package_entry_json)
      select $2::uuid,e.dataset_id,e.source_row,e.id,e.unit_id,e.position_in_unit,'word:m03-shared-'||e.source_row,'m03-fake-noun-'||e.source_row,
      e.headword,e.primary_meaning,'candidate','disabled',false,'occ:m03-'||$2::text||'-'||e.source_row,lower(e.row_sha256),lower(e.row_sha256),
      'exam-review:m03-'||$2::text||'-'||e.source_row,lower(e.row_sha256),'reviewed_for_preview','source_entry_context',
      jsonb_build_object('source','source_entries','source_entry_id','m03-entry-'||e.id,'source_entry_sha256',lower(e.row_sha256)),
      e.row_sha256,'m03-entry-'||e.id,lower(e.row_sha256),true,'{"status":"disabled"}','{}' from vocab_entries e where e.dataset_id=$1`, [source, release]);
    if (approved) await approveRelease(source, release);
  }
  async function approveRelease(source: string, release: string) {
    await db.query(`insert into word_index.mock_wordbook_identity_review(source_release_id,source_entry_id,source_row_sha256,
      reviewed_headword,reviewed_gloss,lexical_pos,sense_id,review_evidence_sha256)
      select $2,e.id,e.row_sha256,e.headword,e.primary_meaning,'noun','m03-fake-noun-1',repeat('d',64)
      from vocab_entries e where e.dataset_id=$1 and e.source_row=1`, [source, release]);
  }

type Plan={vocab_entry_id:number;base_order_index:number;direction:"english_to_korean"|"korean_to_english";choice_vocab_entry_ids:number[]}[];
type Identity={wordKey:string;meaningKey:string;identityKind:string;sourceBinding?:unknown};
type Preview={sourceHash:string;sourceKind:string;items:{entryId:number;direction:string;meaningKey:string;wordKey:string;meaningProofHash:string;identity:Identity}[]};
async function plan(count=4,english=count):Promise<Plan>{
  const entries=await rows<{id:number}>("select id from vocab_entries where dataset_id=$1 order by source_row",[dataset]);
  return entries.slice(0,count).map((e,index)=>({vocab_entry_id:e.id,base_order_index:index+1,
    direction:index<english?"english_to_korean":"korean_to_english",choice_vocab_entry_ids:[e.id,...entries.filter(x=>x.id!==e.id).slice(0,3).map(x=>x.id)]}));
}
async function source(kind:"raw"|"exam",count=4){
  if(count>4){
    await db.query(`insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,n,'frozen'||n,'frozen'||n,array['고정 뜻'||n],'고정 뜻'||n,upper(encode(extensions.digest(n::text,'sha256'),'hex')),$2,n,'word' from generate_series(5,$3)n`,[dataset,unit,count]);
    await db.query("update vocab_datasets set row_count=$2 where id=$1",[dataset,count]);
    await db.query("update vocab_units set entry_count=$2 where id=$1",[unit,count]);
  }
  await ordinarySource(count);
  if(kind==="exam"){
    await seedRelease(dataset,id(61),false);
    await db.query(`update vocab_datasets set metadata=jsonb_build_object('projectionProfile','exam_scope_candidate_v1',
      'packageVersion',(select package_version from word_index.app_exam_use_release where release_id=$2)) where id=$1`,[dataset,id(61)]);
  }
  await db.exec("select set_config('request.jwt.claim.role','service_role',true)");
}
async function preview(questions:Plan):Promise<Preview>{
  return (await service<{value:Preview}>("select public.preview_mixed_primary_meanings_v1($1,$2,array[$3]::uuid[],$4) value",
    [admin,dataset,unit,JSON.stringify(questions.map(q=>({entryId:q.vocab_entry_id,direction:q.direction}))) ]))[0].value;
}
async function ordinary(questions:Plan,ratio=100){
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated`);
  const result=(await rows<{id:string}>(`select public.create_assignment_with_delivery_v7('가짜 경계검사',$1,array[$2]::uuid[],$3,$4::smallint,300,80::smallint,false,null::smallint,'fixed',null,array[$5]::uuid[],'none',null,$6) id`,
    [dataset,unit,questions.length,ratio,student,JSON.stringify(questions)]))[0].id;
  await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',true)");return result;
}
async function parent(n:number,total=4,ratio=100){
  const aid=id(n);
  await db.query(`insert into assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,
    timing_mode,passing_score,status,created_by,retake_allowed,range_basis,question_bank_version,assignment_purpose,quiz_content_mode)
    values($1,'가짜 혼합 초안',$2,1,4,$3,$4,300,'none',80,'draft',$5,false,'units',2,'mixed','book_meaning_choice')`,[aid,dataset,total,ratio,admin]);
  await db.query("insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values($1,$2,$3,1,true)",[aid,dataset,unit]);
  await db.query("insert into assignment_students(assignment_id,student_id,assigned_by) values($1,$2,$3)",[aid,student,admin]);return aid;
}
async function insertPrimary(aid:string,questions:Plan,english=questions.filter(q=>q.direction==="english_to_korean").length,actor=admin){
  return (await rows<{value:{sourceKind:string;questions:{meaningKey:string;wordKey:string;questionContentSha256:string;contentVersionId:string}[];questionCount:number;englishCount:number}}>(
    "select private.insert_mixed_primary_questions_v1($1,$2,$3,array[$4]::uuid[],array[$4]::uuid[],$5,$6,$7) value",
    [aid,actor,student,unit,questions.length,english,JSON.stringify(questions)]))[0].value;
}
const identities=(aid:string)=>rows<{id:number;direction:string;value:Identity}>(`select vocab_entry_id id,direction,private.assignment_vocabulary_meaning_v1(id) value
  from assignment_questions where assignment_id=$1 order by vocab_entry_id,direction`,[aid]);
async function mixedBatch(kind:"raw"|"exam"="raw",allWrong=false){
  await source(kind);const originalPlan=await plan(4,2),aid=await ordinary(originalPlan,50);
  const attempt=(await service<{value:string}>("select public.create_quiz_attempt_from_bank($1,$2) value",[student,aid]))[0].value;
  const questions=await rows<{id:string;vocab_entry_id:number;correct_choice_index:number}>("select id,vocab_entry_id,correct_choice_index from quiz_questions where attempt_id=$1 order by order_index",[attempt]);
  for(const question of questions){
    await rows("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '1 second' where id=$1",[attempt]);
    const wrong=allWrong||question.vocab_entry_id!==originalPlan[1].vocab_entry_id;
    await service("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false)",[student,attempt,question.id,wrong?(question.correct_choice_index+1)%4:question.correct_choice_index]);
  }
  const targets=(await rows<{value:unknown}>(`select jsonb_agg(jsonb_build_object('sourceQuestionId',r.quiz_question_id,'sourcePhase',r.phase,
    'meaningKey',r.meaning_key,'episodeId',s.episode_id,'stateVersion',v.version::text)) value
    from private.vocabulary_answer_receipts r join private.student_vocabulary_meaning_states s on s.student_id=r.student_id and s.meaning_key=r.meaning_key
    join private.student_vocabulary_versions v on v.student_id=r.student_id where r.student_id=$1 and r.outcome='wrong'`,[student]))[0].value;
  await db.exec(`select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated`);
  await rows("select public.queue_student_vocabulary_mistakes_v1($1,$2)",[student,targets]);await db.exec("reset role");
  const selection={mode:"mixed",datasetId:dataset,primaryUnitIds:[unit],reviewScope:"dataset",reviewLevels:[1,2]};
  const raw=(await service<{value:unknown}>("select public.prepare_mixed_mistake_source_v1($1,$2,$3) value",[admin,student,selection]))[0].value;
  const current=mistakePracticeSourceSchema.parse(raw),queueIds=(raw as {queueIds:string[]}).queueIds;
  const voice={displayKo:null,variantId:null,audioUrl:null,available:false};
  const reviewQuestions=current.words.map((word,index)=>({...word.frozenQuestion,wordKey:word.wordKey,meaningKey:word.meaningKey,episodeId:word.episodeId,
    sourceQuestionId:word.sourceQuestionId,sourcePhase:word.sourcePhase,sourceContentHash:word.sourceContentHash,
    pronunciation:voice,choicePronunciations:[voice,voice,voice,voice],choiceSources:[],queueId:queueIds[index]}));
  const selected=allWrong?[]:[{...originalPlan[1],base_order_index:1}],proof=allWrong?null:await preview(selected);
  const primaryQuestions=selected.map(q=>({...q,...Object.fromEntries(Object.entries(proof!.items.find(p=>p.entryId===q.vocab_entry_id)!).filter(([key])=>["meaningKey","wordKey","meaningProofHash"].includes(key)))}));
  return{studentId:student,audienceMode:"single",gradeConfirmed:false,selection,sourceHash:current.sourceHash,
    primaryRequests:selected.map(q=>({entryId:q.vocab_entry_id,direction:q.direction})),primarySourceHash:proof?.sourceHash??null,
    settings:{questionCount:4,englishToKoreanRatio:50,timingMode:"none",timeLimitSeconds:null as number|null,questionTimeLimitSeconds:null,
      passingScore:80,retryEnabled:false,retryPassingScore:null,title:"가짜 혼합",questionOrderMode:"ascending",availableFrom:null,availableUntil:null},
    banks:[{index:0,questionCount:4,primaryQuestionCount:primaryQuestions.length,reviewMeaningCount:reviewQuestions.length,
      quizContentMode:"book_meaning_choice",englishToKoreanRatio:50,timeLimitSeconds:null as number|null,primaryQuestions,reviewQuestions}]};
}
async function saveMixed(batch:Awaited<ReturnType<typeof mixedBatch>>,key=id(700),hash="c".repeat(64)){
  try{return(await service<{value:{studentId:string;assignmentId:string;questionCount:number}[]}>(
    "select public.create_mixed_mistake_assignments_v1($1,$2,$3,$4) value",[admin,key,hash,[batch]]))[0].value;}
  catch(error){const failure=error as Error&{where?:string;detail?:string};throw new Error([failure.message,failure.detail,failure.where].filter(Boolean).join("\n"),{cause:error});}
}
function splitMixed(batch:Awaited<ReturnType<typeof mixedBatch>>){
  const bank=batch.banks[0],english=bank.reviewQuestions.filter(q=>q.direction==="english_to_korean"),korean=bank.reviewQuestions.filter(q=>q.direction==="korean_to_english");
  batch.banks=[{...bank,index:0,questionCount:1,primaryQuestionCount:1,reviewMeaningCount:0,englishToKoreanRatio:100,reviewQuestions:[]},
    {...bank,index:1,questionCount:english.length,primaryQuestionCount:0,reviewMeaningCount:english.length,englishToKoreanRatio:100,primaryQuestions:[],reviewQuestions:english},
    {...bank,index:2,questionCount:korean.length,primaryQuestionCount:0,reviewMeaningCount:korean.length,englishToKoreanRatio:0,primaryQuestions:[],reviewQuestions:korean}];
  return batch;
}
async function unchangedTables(tables:string[]){
  return Promise.all(tables.map(async table=>(await rows(`select coalesce(jsonb_agg(value order by value::text),'[]') value from(select to_jsonb(r) value from ${table} r) r`))[0].value));
}
type StartedMixedQuestion={id:string;assignment_question_id:string;vocab_entry_id:number;order_index:number;direction:string;prompt:string;choices:string[];correct_choice_index:number;meaning_key:string};
async function beginMixed(assignmentId:string){
  const preparationId=(await service<{value:string}>("select public.prepare_quiz_attempt_v1($1,$2,null::jsonb) value",[student,assignmentId]))[0].value;
  const prep=(await service<{value:{id:string;kind:string;begunId:string|null;plan:StartedMixedQuestion[]}}>("select public.get_quiz_preparation_v1($1,$2) value",[student,preparationId]))[0].value;
  expect(prep).toMatchObject({id:preparationId,kind:"initial",begunId:null});
  const expected=await rows(`select id assignment_question_id,vocab_entry_id,base_order_index order_index,direction,prompt,choices,correct_choice_index
    from private.assignment_question_contents_v1 where assignment_id=$1 order by base_order_index`,[assignmentId]);
  expect(prep.plan.map(({assignment_question_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index})=>({assignment_question_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index}))).toEqual(expected);
  expect(await rows("select count(*)::int n from quiz_attempts where assignment_id=$1",[assignmentId])).toEqual([{n:0}]);
  const attemptId=(await service<{value:string}>("select public.begin_prepared_quiz_v1($1,$2) value",[student,preparationId]))[0].value;
  const clocks=()=>rows("select started_at::text,deadline_at::text,current_question_started_at::text from quiz_attempts where id=$1",[attemptId]);
  const first=await clocks();
  expect((await service<{value:string}>("select public.begin_prepared_quiz_v1($1,$2) value",[student,preparationId]))[0].value).toBe(attemptId);
  expect(await clocks()).toEqual(first);
  expect(await rows("select count(*)::int n from quiz_attempts where assignment_id=$1",[assignmentId])).toEqual([{n:1}]);
  const questions=await rows<StartedMixedQuestion>(`select q.*,private.quiz_vocabulary_meaning_v1(q.id)->>'meaningKey' meaning_key
    from private.quiz_question_contents_v1 q where q.attempt_id=$1 order by q.order_index`,[attemptId]);
  expect(questions.map(q=>q.id)).toEqual(prep.plan.map(q=>q.id));
  expect(await rows(`select count(*)::int n,bool_and(physical.prompt is null and physical.choices is null
    and physical.content_version_id=bank.content_version_id and resolved.prompt is not distinct from bank.prompt
    and resolved.choices is not distinct from bank.choices and resolved.correct_choice_index=bank.correct_choice_index
    and private.quiz_vocabulary_meaning_v1(physical.id) is not distinct from private.assignment_vocabulary_meaning_v1(bank.id)) preserved
    from quiz_questions physical join private.quiz_question_contents_v1 resolved on resolved.id=physical.id
    join private.assignment_question_contents_v1 bank on bank.id=physical.assignment_question_id where physical.attempt_id=$1`,[attemptId])).toEqual([{n:expected.length,preserved:true}]);
  return {attemptId,questions};
}
async function answerMixed(attemptId:string,q:StartedMixedQuestion,correct:boolean){
  await rows("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '1 second' where id=$1",[attemptId]);
  const choice=correct?q.correct_choice_index:(q.correct_choice_index+1)%4;
  await service("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false)",[student,attemptId,q.id,choice]);
  expect(await rows("select meaning_key,phase,outcome from private.vocabulary_answer_receipts where quiz_question_id=$1 and phase='initial'",[q.id]))
    .toEqual([{meaning_key:q.meaning_key,phase:"initial",outcome:correct?"correct":"wrong"}]);
  return choice;
}
async function activeMixed(meaningKey:string){return(await rows<{active:boolean}>("select exists(select 1 from private.current_vocabulary_meaning_states_v1($1) where meaning_key=$2 and unresolved) active",[student,meaningKey]))[0].active;}
beforeAll(async()=>{db=await createFinalSchemaDatabase();await db.exec("grant usage on schema auth,extensions to service_role;alter role service_role bypassrls");await seed();},120_000);
beforeEach(async()=>{await db.exec("begin");});afterEach(async()=>{await db.exec("rollback;reset role");});afterAll(async()=>{await db?.close();});

describe.sequential("혼합 배정 일반 문항의 뜻 미리보기와 검증된 삽입",()=>{
  it("자료 변경과 같은 요청의 다른 내용은 재시도 SQLSTATE 대신 PT409로 끝나고 쓰기를 남기지 않는다",async()=>{
    const batch=await mixedBatch();
    const tables=["assignments","assignment_questions","student_vocab_review_queue","private.notebook_assignment_requests"];
    const assertConflict=async(query:string,args:unknown[],message:string)=>{
      const before=await unchangedTables(tables);
      await db.exec("savepoint domain_conflict");
      try{await expect(service(query,args)).rejects.toMatchObject({code:"PT409",message});}
      finally{await db.exec("rollback to domain_conflict;release domain_conflict;reset role");}
      expect(await unchangedTables(tables)).toEqual(before);
    };
    await assertConflict("select public.create_mixed_mistake_assignments_v1($1,$2,$3,$4)",
      [admin,id(700),"c".repeat(64),[{...batch,sourceHash:"f".repeat(64)}]],"notebook_source_changed");
    await saveMixed(batch);
    await assertConflict("select public.get_notebook_assignment_result_v1($1,$2,$3)",
      [admin,id(700),"d".repeat(64)],"notebook_request_conflict");
    await assertConflict("select public.create_mixed_mistake_assignments_v1($1,$2,$3,$4)",
      [admin,id(700),"d".repeat(64),[batch]],"notebook_request_conflict");
  });
  it("혼합 시험은 내용 변조를 거절하고 정상 삭제와 재요청에서 원 기록을 보존한다",async()=>{
    const saved=await saveMixed(splitMixed(await mixedBatch()));
    const aid=saved[0].assignmentId;
    await fails(()=>rows("update assignments set title='changed',status='closed',deleted_at=now(),deleted_by=$2,deletion_reason='fake deletion' where id=$1",[aid,admin]),"assignment_source_policy_immutable");
    await fails(()=>rows("update assignments set deletion_reason='only a reason' where id=$1",[aid]),"assignments_deletion_state_check");
    const started=await beginMixed(aid);
    await db.exec("select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated");
    await fails(()=>rows("select public.delete_assignment_v2($1,'검사 삭제')",[aid]),"assignment_has_in_progress_attempt");
    await db.exec("reset role");
    await answerMixed(started.attemptId,started.questions[0],false);
    const tables=["assignment_questions","quiz_questions","quiz_attempts","private.vocabulary_answer_receipts","private.vocabulary_question_content_versions","assignment_sources"];
    const before=await unchangedTables(tables);
    await db.exec("select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated");
    for(const item of saved)await rows("select public.delete_assignment_v2($1,'검사 삭제')",[item.assignmentId]);
    await db.exec("reset role");
    expect(await unchangedTables(tables)).toEqual(before);
    const headers=await rows("select id,status,deleted_at,deleted_by,deletion_reason from assignments where id=any($1::uuid[]) order by id",[saved.map(a=>a.assignmentId)]);
    expect(headers).toHaveLength(3);for(const header of headers)expect(header).toMatchObject({status:"closed",deleted_by:admin,deletion_reason:"검사 삭제"});
    await db.exec("select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated");
    await rows("select public.delete_assignment_v2($1,'재전송 사유')",[aid]);
    await db.exec("reset role");
    expect(await rows("select id,status,deleted_at,deleted_by,deletion_reason from assignments where id=any($1::uuid[]) order by id",[saved.map(a=>a.assignmentId)])).toEqual(headers);
    await fails(()=>rows("update assignments set deletion_reason='tampered' where id=$1",[aid]),"deleted_assignment");
  });
  it.each(["raw","exam"] as const)("%s: 분할 시험의 준비·시작·답 저장·중복 답 복구가 원뜻과 서로 다른 뜻의 상태를 보존한다",async kind=>{
    const batch=splitMixed(await mixedBatch(kind)),saved=await saveMixed(batch);
    const reviewKeys=batch.banks.flatMap(bank=>bank.reviewQuestions.map(q=>q.meaningKey));
    for(const key of reviewKeys)expect(await activeMixed(key)).toBe(true);
    const primary=await beginMixed(saved[0].assignmentId),p=primary.questions[0];
    expect(primary.questions).toHaveLength(1);expect(reviewKeys).not.toContain(p.meaning_key);expect(await activeMixed(p.meaning_key)).toBe(false);
    const choice=await answerMixed(primary.attemptId,p,false);
    for(const key of reviewKeys)expect(await activeMixed(key)).toBe(true);
    const state=()=>rows("select episode_id,current_wrong_count,unresolved from private.current_vocabulary_meaning_states_v1($1) where meaning_key=$2",[student,p.meaning_key]);
    const once=await state();expect(once).toMatchObject([{current_wrong_count:1,unresolved:true}]);
    await service("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false)",[student,primary.attemptId,p.id,choice]);expect(await state()).toEqual(once);
    const single=await beginMixed(saved[1].assignmentId),resolved=single.questions[0];
    expect(single.questions).toHaveLength(1);expect(resolved.meaning_key).toBe(batch.banks[1].reviewQuestions[0].meaningKey);
    await answerMixed(single.attemptId,resolved,true);expect(await activeMixed(resolved.meaning_key)).toBe(false);expect(await activeMixed(p.meaning_key)).toBe(true);
    const pair=await beginMixed(saved[2].assignmentId),[failed,passed]=pair.questions;
    expect(pair.questions.map(q=>q.meaning_key)).toEqual(batch.banks[2].reviewQuestions.map(q=>q.meaningKey));
    const before=(await rows<{episode_id:string;current_wrong_count:number}>("select episode_id,current_wrong_count from private.current_vocabulary_meaning_states_v1($1) where meaning_key=$2",[student,failed.meaning_key]))[0];
    await answerMixed(pair.attemptId,failed,false);await answerMixed(pair.attemptId,passed,true);
    expect(await rows("select episode_id,current_wrong_count,unresolved from private.current_vocabulary_meaning_states_v1($1) where meaning_key=$2",[student,failed.meaning_key]))
      .toEqual([{episode_id:before.episode_id,current_wrong_count:before.current_wrong_count+1,unresolved:true}]);
    expect(await activeMixed(passed.meaning_key)).toBe(false);expect(await activeMixed(resolved.meaning_key)).toBe(false);expect(await activeMixed(p.meaning_key)).toBe(true);
  });
  it.each(["raw","exam"] as const)("%s: 혼합 전체 저장은 1 일반+3 오답의 비율과 원큐·본문 참조를 보존한다",async(kind)=>{
    const batch=await mixedBatch(kind),queueBefore=await rows("select count(*)::int n from student_vocab_review_queue"),saved=await saveMixed(batch);
    expect(saved).toHaveLength(1);expect(saved[0]).toMatchObject({studentId:student,questionCount:4});
    expect(await rows("select count(*)::int n from student_vocab_review_queue")).toEqual(queueBefore);
    expect(await rows("select status,count(*)::int n from student_vocab_review_queue group by status")).toEqual([{status:"consumed",n:3}]);
    expect(await rows(`select count(*)::int n,count(*)filter(where direction='english_to_korean')::int e,
      bool_and(prompt is null and choices is null and content_version_id is not null) compact from assignment_questions where assignment_id=$1`,[saved[0].assignmentId]))
      .toEqual([{n:4,e:2,compact:true}]);
    expect(await rows(`select o.source_question_id,o.source_phase from private.notebook_question_origins_v2 o
      join assignment_questions q on q.id=o.assignment_question_id where q.assignment_id=$1 order by q.base_order_index`,[saved[0].assignmentId]))
      .toEqual(batch.banks[0].reviewQuestions.map(q=>({source_question_id:q.sourceQuestionId,source_phase:q.sourcePhase})));
    const before=await unchangedTables(["assignments","assignment_questions","student_vocab_review_queue","private.notebook_assignment_requests"]);
    expect(await saveMixed(batch)).toEqual(saved);expect(await unchangedTables(["assignments","assignment_questions","student_vocab_review_queue","private.notebook_assignment_requests"])).toEqual(before);
    await fails(()=>saveMixed(batch,id(700),"d".repeat(64)),"notebook_request_conflict");
  });
  it("혼합 저장은 일반만·오답만 분리된 은행을 모두 활성화하고 자기 큐 소비를 변경으로 오인하지 않는다",async()=>{
    const batch=splitMixed(await mixedBatch()),saved=await saveMixed(batch);
    expect(saved.map(row=>row.questionCount)).toEqual([1,1,2]);
    expect(await rows("select count(*)::int n from assignments where id=any($1::uuid[]) and status='active'",[saved.map(row=>row.assignmentId)])).toEqual([{n:3}]);
    expect(await rows("select count(*)::int n from assignment_review_targets where assignment_id=any($1::uuid[]) and released_at is null",[saved.map(row=>row.assignmentId)])).toEqual([{n:3}]);
  });
  it("혼합 전체가 오답인 경우 일반 문항을 억지로 만들지 않는다",async()=>{
    const batch=await mixedBatch("raw",true),saved=await saveMixed(batch);
    expect(batch.primarySourceHash).toBeNull();expect(saved[0].questionCount).toBe(4);
    expect(await rows("select count(*)::int n from private.notebook_question_origins_v2 where assignment_question_id in(select id from assignment_questions where assignment_id=$1)",[saved[0].assignmentId])).toEqual([{n:4}]);
  });
  it("혼합 마지막 은행 실패는 앞 은행·큐 소비·공용 참조·영수증까지 모두 되돌린다",async()=>{
    const batch=splitMixed(await mixedBatch());
    await db.exec(`create function pg_temp.fail_second_mixed_bank() returns trigger language plpgsql as $$begin
      if new.assignment_purpose='mixed' and new.status='active' and new.question_count=2 then raise exception 'fake_last_bank_failure';end if;return new;end;$$;
      create trigger fake_last_mixed_bank before update on assignments for each row execute function pg_temp.fail_second_mixed_bank()`);
    const tables=["assignments","assignment_questions","assignment_students","assignment_units","student_vocab_review_queue","assignment_review_targets",
      "private.notebook_question_origins_v2","private.vocabulary_question_content_versions","private.notebook_assignment_requests"],before=await unchangedTables(tables);
    await fails(()=>saveMixed(batch),"fake_last_bank_failure");expect(await unchangedTables(tables)).toEqual(before);
  });
  it.each(["source","phase","queue","proof"])("혼합 %s 바꿔치기는 배정 쓰기 전에 거절한다",async field=>{
    const batch=await mixedBatch(),bank=batch.banks[0];
    if(field==="source")batch.sourceHash="f".repeat(64);
    if(field==="phase")bank.reviewQuestions[0].sourcePhase="retry";
    if(field==="queue")bank.reviewQuestions[0].queueId=bank.reviewQuestions[1].queueId;
    if(field==="proof")Object.assign(bank.primaryQuestions[0],{meaningProofHash:"f".repeat(64)});
    const before=await unchangedTables(["assignments","assignment_questions","student_vocab_review_queue","private.notebook_assignment_requests"]);
    await fails(()=>saveMixed(batch),field==="proof"?"mixed_primary_source_changed":field==="queue"?"invalid_mixed_review_selection":"notebook_source_changed");
    expect(await unchangedTables(["assignments","assignment_questions","student_vocab_review_queue","private.notebook_assignment_requests"])).toEqual(before);
  });
  it.each(["raw","exam"] as const)("%s: 실제 공개 생성과 같은 문항·뜻·공용 본문을 쓰고 부모 설정은 보존한다",async(kind)=>{
    await source(kind);const questions=await plan(4,2),expected=await preview(questions);
    const ordinaryId=await ordinary(questions,50),aid=await parent(100,4,50);
    const tables=["assignments","assignment_students","assignment_units","assignment_sources","audit_events"];
    const before=await unchangedTables(tables),inserted=await insertPrimary(aid,questions);
    expect(await unchangedTables(tables)).toEqual(before);expect(inserted.sourceKind).toBe(kind==="raw"?"raw-v2":"exam-use");
    expect(inserted.questionCount).toBe(4);expect(inserted.englishCount).toBe(2);
    expect((await identities(aid)).map(x=>x.value)).toEqual(expected.items.map(x=>x.identity));
    expect(await identities(aid)).toEqual(await identities(ordinaryId));
    const bodies=(assignment:string)=>rows(`select vocab_entry_id,direction,base_order_index,question_content_sha256,content_version_id,
      prompt,choices,correct_choice_index,provenance from private.assignment_question_contents_v1 where assignment_id=$1 order by base_order_index`,[assignment]);
    expect(await bodies(aid)).toEqual(await bodies(ordinaryId));
    expect(await rows("select count(*)::int n from private.assignment_vocabulary_new_questions")).toEqual([{n:0}]);
    await fails(()=>insertPrimary(aid,questions),"mixed_primary_parent_not_empty");
  });
  it.each(["raw","exam"] as const)("%s: 분리된 1문항 부모와 보기 4개를 보존한다",async(kind)=>{
    await source(kind);const questions=await plan(1),aid=await parent(101,1);const expected=await preview(questions);
    const result=await insertPrimary(aid,questions);expect(result.questions).toHaveLength(1);
    expect(result.questions[0].meaningKey).toBe(expected.items[0].meaningKey);
    expect(await rows("select jsonb_array_length(choices)::int n from private.assignment_question_contents_v1 where assignment_id=$1",[aid])).toEqual([{n:4}]);
  });
  it("일반 200문항 중 영어→뜻 101개를 반올림 비율로 바꾸지 않고 정확히 저장한다",async()=>{
    await source("raw",200);const questions=await plan(200,101),aid=await parent(102,204,50);
    const result=await insertPrimary(aid,questions,101);expect(result.englishCount).toBe(101);expect(result.questions).toHaveLength(200);
    expect(await rows("select count(*)::int total,count(*)filter(where direction='english_to_korean')::int english from assignment_questions where assignment_id=$1",[aid])).toEqual([{total:200,english:101}]);
  });
  it("원고 연결이 없을 때도 미리보기는 실제 원출현 뜻과 같고, 연결을 만든 뒤에는 새 뜻만 채택한다",async()=>{
    await source("raw");const questions=await plan(4,2),before=await preview(questions),old=await ordinary(questions,50);
    expect(before.items.every(x=>!x.identity.sourceBinding)).toBe(true);
    await importRawMeaningScope();const after=await preview(questions),fresh=await ordinary(questions,50);
    expect(after.items.every(x=>x.identity.sourceBinding)).toBe(true);
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect((await identities(old)).map(x=>x.value)).toEqual(before.items.map(x=>x.identity));
    expect((await identities(fresh)).map(x=>x.value)).toEqual(after.items.map(x=>x.identity));
  });
  it("exam-use 승인 근거가 바뀌면 새 뜻과 계획 확인값만 바뀌고 과거 뜻은 그대로 남는다",async()=>{
    await source("exam");const questions=await plan(),before=await preview(questions),old=await ordinary(questions);
    await approveRelease(dataset,id(61));const after=await preview(questions),fresh=await ordinary(questions);
    expect(before.items[0].identity.identityKind).toBe("source-occurrence-v1");expect(after.items[0].identity.identityKind).toBe("reviewed-meaning-v1");
    expect(after.items[0].meaningProofHash).not.toBe(before.items[0].meaningProofHash);
    expect((await identities(old)).map(x=>x.value)).toEqual(before.items.map(x=>x.identity));
    expect((await identities(fresh)).map(x=>x.value)).toEqual(after.items.map(x=>x.identity));
  });
  it("미리보기를 반복해도 배정·학생·본문·뜻 연결·신규 표시를 쓰지 않는다",async()=>{
    await source("raw");await importRawMeaningScope();const questions=await plan(4,2);
    const tables=["assignments","assignment_students","assignment_questions","private.assignment_vocabulary_new_questions",
      "private.assignment_vocabulary_meaning_refs","private.vocabulary_question_meaning_versions","private.vocabulary_question_content_versions",
      "private.vocabulary_learning_value_bindings"];
    const before=await unchangedTables(tables);expect(await preview(questions)).toEqual(await preview(questions));expect(await unchangedTables(tables)).toEqual(before);
  });
  it("누락·제외된 대상과 잘못된 범위·입력 필드는 미리보기에서 거절한다",async()=>{
    await source("raw");const questions=await plan();
    await db.query("update vocab_entry_quiz_eligibility set status='excluded',reason_codes=array['unsupported_entry_type'] where vocab_entry_id=$1",[questions[0].vocab_entry_id]);
    await fails(()=>preview(questions),"question_not_eligible_for_direction");
    await fails(()=>rows("select private.preview_new_primary_meanings_v1($1,array[$2]::uuid[],$3)",[dataset,id(999),JSON.stringify([{entryId:questions[0].vocab_entry_id,direction:"english_to_korean"}])]),"mixed_primary_scope_changed");
    await fails(()=>rows("select private.preview_new_primary_meanings_v1($1,array[$2]::uuid[],$3)",[dataset,unit,JSON.stringify([{entryId:questions[0].vocab_entry_id,direction:"english_to_korean",meaningKey:"forged"}])]),"mixed_primary_invalid_selection");
  });
  it("비활성 exam-use를 일반 자료로 대체하지 않으며 저장 전 실패는 부모·본문을 보존한다",async()=>{
    await source("exam");const questions=await plan(),aid=await parent(103);
    await db.query("update word_index.app_exam_use_release set status='retired' where release_id=$1",[id(61)]);
    await fails(()=>preview(questions),"exam_use_release_inactive");await fails(()=>insertPrimary(aid,questions),"exam_use_release_inactive");
    expect(await rows("select count(*)::int n from assignment_questions where assignment_id=$1",[aid])).toEqual([{n:0}]);
  });
  it("다른 관리자·추가 학생·이미 시작한 부모에는 문항을 삽입하지 않는다",async()=>{
    await source("raw");const questions=await plan(),aid=await parent(104);
    await fails(()=>insertPrimary(aid,questions,4,id(999)),"notebook_admin_required");
    await db.query("insert into assignment_students(assignment_id,student_id,assigned_by) values($1,$2,$3)",[aid,id(3),admin]);
    await fails(()=>insertPrimary(aid,questions),"mixed_primary_parent_not_empty");
    await db.query("delete from assignment_students where assignment_id=$1 and student_id=$2",[aid,id(3)]);
    await db.query("update assignments set status='active' where id=$1",[aid]);await fails(()=>insertPrimary(aid,questions),"mixed_primary_parent_invalid");
  });
  it("새 내부 함수는 외부 역할에 공개하지 않고 미리보기는 활성 관리자만 허용한다",async()=>{
    await source("raw");const functions=["raw_vocabulary_learning_binding_core_v1","new_assignment_vocabulary_identity_v1","preview_new_primary_meanings_v1",
      "assert_empty_mixed_primary_parent_v1","insert_mixed_primary_base_v1","insert_mixed_primary_raw_v1","insert_mixed_primary_exam_use_v1","insert_mixed_primary_questions_v1"];
    const privileges=await rows<{name:string;allowed:boolean}>(`select p.proname name,has_function_privilege(r,p.oid,'execute') allowed
      from pg_proc p cross join unnest(array['anon','authenticated','service_role']) r where p.pronamespace='private'::regnamespace and p.proname=any($1::text[])`,[functions]);
    expect(privileges).toHaveLength(functions.length*3);expect(privileges.every(x=>!x.allowed)).toBe(true);
    const questions=await plan();await db.query("update admin_profiles set is_active=false where user_id=$1",[admin]);await fails(()=>preview(questions),"notebook_admin_required");
  });
});
