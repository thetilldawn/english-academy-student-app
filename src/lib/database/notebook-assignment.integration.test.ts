import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createFinalSchemaDatabase} from '@/test-support/final-schema-database';
import {buildPracticePlan,practiceSourceSchema} from '@/features/quiz-player/domain/practice-plan';

const id=(n:number)=>`92000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),student=id(2),other=id(3),selection={mode:'filtered',filters:{}},hash='a'.repeat(64);
const practiceSettings={questionCount:4,englishToKoreanRatio:50 as const,timingMode:'none' as const,timeLimitSeconds:null,questionTimeLimitSeconds:null};
const settings={...practiceSettings,passingScore:80,retryEnabled:false,retryPassingScore:null};
const voice={displayKo:'가짜발음',variantId:null,audioUrl:null,available:false};
describe.sequential('교사 개인 오답 배정: 최종 SQL',()=>{
 let db:PGlite;
 beforeAll(async()=>{
  db=await createFinalSchemaDatabase();
  await db.exec(`begin;
    select set_config('request.jwt.claim.sub','${admin}',true);select set_config('request.jwt.claim.role','authenticated',true);
    insert into auth.users(id) values('${admin}');insert into admin_profiles(user_id,display_name,is_active) values('${admin}','가짜관리자',true);
    insert into students(id,display_name,status,created_by,school_name,grade_label) values('${student}','가짜학생가','active','${admin}','가짜학교','고1'),('${other}','가짜학생나','active','${admin}','가짜학교','고2');
  `);
  for(let book=4;book<=5;book++){
   await db.exec(`
    insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
      values('${id(book)}','notebook-fake-${book}','가짜책${book}','가짜',repeat('A',64),4,'ready','${admin}');
    insert into vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code) values('${id(book)}','가짜책${book}','high','wordbook','g${book===4?10:11}');
    insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values('${id(100+book)}','${id(book)}','DAY 1','day 1','day',1,1,4);
    insert into assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,timing_mode,passing_score,status,created_by)
      values('${id(10+book)}','가짜기존시험','${id(book)}',1,4,4,240,'none',80,'active','${admin}');
    insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values('${id(10+book)}','${id(book)}','${id(100+book)}',1,true);
    insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select '${id(book)}',n,headword,headword,array[meaning],meaning,repeat('B',63)||n::text,'${id(100+book)}',n,'word'
      from unnest(array['collect','travel','patient','enormous'],array['모으다','여행하다','참을성 있는','거대한']) with ordinality x(headword,meaning,n);
    insert into vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select e.id,e.dataset_id,m.mode,'eligible',repeat('B',64),'fixture',clock_timestamp() from vocab_entries e cross join(values('book_meaning_en_to_ko'),('book_meaning_ko_to_en'))m(mode) where e.dataset_id='${id(book)}';
   `);
   if(book===4) await db.exec(`
    insert into word_index.app_exam_use_release(release_id,release_key,dataset_id,dataset_key,schema_version,package_version,source_sha256,candidate_dictionary_version,manifest_content_hash,exam_review_ledger_sha256,wordbook_id,title,target_environment,common_dictionary_release_allowed,exam_use_import_allowed,expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json,activated_at_utc)
      values('${id(800)}','notebook-fake-release','${id(book)}','notebook-fake-${book}','1.0',repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),repeat('a',64),'notebook-fake','가짜 사전 원본','preview',false,true,4,4,4,'active','{"syntheticFixture":true}',clock_timestamp());
    insert into word_index.app_exam_use_occurrence(release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,dictionary_id,display_headword,display_gloss_ko,display_pronunciation_review_status,audio_status,listening_enabled,occurrence_id,occurrence_content_hash,package_entry_content_hash,exam_review_id,exam_input_hash,exam_use_status,context_evidence_status,context_evidence,source_projection_row_sha256,source_entry_id,source_entry_sha256,include_in_exam,audio_json,package_entry_json)
      select '${id(800)}',dataset_id,source_row,id,unit_id,position_in_unit,'word:notebook-fake-'||source_row,headword,primary_meaning,'candidate','disabled',false,'occ:notebook-fake-'||source_row,repeat('a',64),repeat('a',64),'exam-review:notebook-fake-'||source_row,repeat('a',64),'reviewed_for_preview','source_entry_context','{"syntheticFixture":true}',lower(row_sha256),'entry-'||lpad(source_row::text,24,'0'),lower(row_sha256),true,'{}','{"syntheticFixture":true}' from vocab_entries where dataset_id='${id(book)}';
    insert into assignment_questions(assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,dataset_id)
      select '${id(10+book)}',e.id,e.source_row,'english_to_korean',e.headword,(select jsonb_agg(v.primary_meaning order by v.source_row) from vocab_entries v where v.dataset_id=e.dataset_id),(e.source_row-1)::smallint,e.dataset_id from vocab_entries e where e.dataset_id='${id(book)}';
    insert into assignment_question_exam_use_snapshot(assignment_question_id,assignment_id,dataset_id,vocab_entry_id,release_id,dictionary_id,occurrence_id,exam_review_id,headword_snapshot,primary_meaning_snapshot,pronunciation_snapshot,choice_dictionary_snapshots,occurrence_content_hash,question_content_sha256,provenance_status)
      select q.id,q.assignment_id,q.dataset_id,q.vocab_entry_id,o.release_id,o.dictionary_id,o.occurrence_id,o.exam_review_id,o.display_headword,o.display_gloss_ko,'{}','[{},{},{},{}]',o.occurrence_content_hash,repeat('A',64),'reviewed_for_preview_v1' from assignment_questions q join word_index.app_exam_use_occurrence o on o.vocab_entry_id=q.vocab_entry_id where q.assignment_id='${id(10+book)}';
   `);
   for(const [index,who] of [student,other].entries()){
    const run=id(60+book*10+index);
    await db.exec(`
     insert into assignment_students(assignment_id,student_id,assigned_by) values('${id(10+book)}','${who}','${admin}');
     insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
      values('${run}','${who}','${id(10+book)}',1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',clock_timestamp()-interval '1 day',4,240,80,'initial');
     insert into quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index,assignment_question_id)
      select ('92000000-0000-4000-8000-'||lpad((${book*1000+index*100}+e.source_row)::text,12,'0'))::uuid,'${run}',e.id,e.source_row,'english_to_korean',e.headword,
        (select jsonb_agg(v.primary_meaning order by v.source_row) from vocab_entries v where v.dataset_id=e.dataset_id),(e.source_row-1)::smallint,aq.id
        from vocab_entries e left join assignment_questions aq on aq.assignment_id='${id(10+book)}' and aq.vocab_entry_id=e.id where e.dataset_id='${id(book)}';
     insert into student_vocab_wrong_events(student_id,dataset_id,vocab_entry_id,quiz_attempt_id,quiz_question_id,wrong_stage,wrong_at)
      select '${who}','${id(book)}',vocab_entry_id,attempt_id,id,'initial',clock_timestamp() from quiz_questions where attempt_id='${run}' and order_index between ${index?3:1} and ${index?4:2};
    `);
   }
  }
  await db.exec('commit');
 },120000);
 beforeEach(async()=>{await db.exec("begin;select set_config('request.jwt.claim.role','service_role',true)");});
 afterEach(async()=>{await db.exec('rollback');});
 afterAll(async()=>{await db?.close();});
 async function rpc<T=unknown>(name:string,args:unknown[]){await db.exec('set local role service_role');return(await db.query<{value:T}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) value`,args)).rows[0].value;}
 async function owner<T=Record<string,unknown>>(sql:string,args:unknown[]=[]){await db.exec('reset role');return(await db.query<T>(sql,args)).rows;}
 async function fails(action:()=>Promise<unknown>,message:string){await db.exec('savepoint expected_failure');try{await expect(action()).rejects.toThrow(message);}finally{await db.exec('rollback to expected_failure;release expected_failure');}}
 async function prepare(who=student){
  const raw=await rpc<Record<string,unknown>>('prepare_notebook_assignment_source_v1',[admin,who,selection]);
  const source=practiceSourceSchema.parse(raw),plan=buildPracticePlan(source,practiceSettings,id(400)+who),byId=new Map(plan.candidates.map(e=>[e.id,e]));
  expect(plan.error).toBeNull();
  const questions=plan.questions.map(q=>({wordKey:byId.get(q.vocabEntryId)!.key,direction:q.direction,prompt:q.prompt,choices:q.choices,correctChoiceIndex:q.correctChoiceIndex,pronunciation:voice,choicePronunciations:[voice,voice,voice,voice],
    choiceSources:q.choiceVocabEntryIds.map(id=>{const e=byId.get(id)!;return{entryId:e.entryId,headword:e.headword,primaryMeaning:e.primaryMeaning};})}));
  return{studentId:who,selection,settings,sourceHash:source.sourceHash,questions,audienceMode:'bulk',gradeConfirmed:true};
 }
 const save=async(batches:Awaited<ReturnType<typeof prepare>>[],key=id(400))=>rpc<{studentId:string;assignmentId:string;questionCount:number}[]>('create_notebook_assignments_v1',[admin,key,hash,batches]);
 it('학생별 실제 원책·문항을 저장하고 재전송은 기존 영수증을 돌려준다',async()=>{
  const batches=[await prepare(),await prepare(other)],before=await owner('select * from assignment_question_exam_use_snapshot');
  const result=await save(batches);expect(result).toHaveLength(2);
  await owner('set constraints all immediate');
  for(const item of result){
   const [header]=await owner('select source_kind,points_policy_version,question_count from assignments where id=$1',[item.assignmentId]);
   expect(header).toEqual({source_kind:'notebook',points_policy_version:'no-points-v1',question_count:4});
   expect(await owner('select dataset_id from assignment_sources where assignment_id=$1',[item.assignmentId])).toHaveLength(2);
   expect(await owner('select 1 from assignment_units where assignment_id=$1 and is_primary',[item.assignmentId])).toHaveLength(0);
   const rows=await owner<{source_row:number}>('select e.source_row from assignment_questions q join vocab_entries e on e.id=q.vocab_entry_id where q.assignment_id=$1',[item.assignmentId]);
   expect(rows.every(r=>item.studentId===student?r.source_row<=2:r.source_row>=3)).toBe(true);
  }
  expect(await owner('select * from assignment_question_exam_use_snapshot')).toEqual(before);
  await owner("update students set grade_label='고3' where id=$1",[student]);
  expect(await save(batches)).toEqual(result);
  await fails(()=>rpc('get_notebook_assignment_result_v1',[admin,id(400),'b'.repeat(64)]),'notebook_request_conflict');
 });
 it('학년 차이·현재 학년 변경·타인 원문항·중복 단어·출제 불가를 저장 직전에 막는다',async()=>{
  const batch=await prepare();
  await fails(()=>save([{...batch,gradeConfirmed:false}]),'notebook_grade_review_required');
  await owner("update students set grade_label='고3' where id=$1",[student]);
  await fails(()=>save([batch]),'notebook_source_changed');
  const current=await prepare(),different=await prepare(other);
  await fails(()=>save([{...current,questions:different.questions}]),'notebook_invalid_questions');
  await fails(()=>save([{...current,questions:[current.questions[0],...current.questions.slice(0,3)]}]),'notebook_invalid_questions');
  await owner('delete from vocab_entry_quiz_eligibility where dataset_id=$1',[id(5)]);
  await fails(()=>save([current]),'notebook_source_changed');
  expect(await owner("select 1 from assignments where source_kind='notebook'")).toHaveLength(0);
 });
 it('복수 학생 중 한 명 오류는 전체를 취소하고 역할/프로필/상한을 지킨다',async()=>{
  const batch=await prepare();
  const second=await prepare(other);
  await fails(()=>save([batch,{...second,settings:{...settings,passingScore:101}}]),'notebook_invalid_settings');
  expect(await owner("select 1 from assignments where source_kind='notebook'")).toHaveLength(0);
  await fails(()=>save(Array(211).fill(batch)),'notebook_invalid_batch');
  await owner("update students set school_name=null where id=$1",[student]);
  await fails(()=>prepare(),'notebook_student_profile_required');
  await owner("select set_config('request.jwt.claim.role','authenticated',true)");
  await fails(()=>rpc('prepare_notebook_assignment_source_v1',[admin,other,selection]),'notebook_admin_required');
 });
 it('출처/문항 삭제·헤더 변조를 막고 기존 책의 포인트 정책은 바꾸지 않는다',async()=>{
  const [saved]=await save([await prepare()]);await owner('set constraints all immediate');
  await fails(()=>owner('delete from assignment_sources where assignment_id=$1 and dataset_id<>(select dataset_id from assignments where id=$1)',[saved.assignmentId]),'notebook_question_immutable');
  await fails(()=>owner('delete from assignment_questions where assignment_id=$1',[saved.assignmentId]),'notebook_question_immutable');
  await fails(()=>owner('update assignments set question_count=1 where id=$1',[saved.assignmentId]),'assignment_source_');
  await fails(()=>owner('update assignments set dataset_id=$1 where id=$2',[id(5),id(14)]),'assignment_source_relation_mismatch');
  expect((await owner("select count(*)::integer n from assignments where source_kind='book' and points_policy_version='vocab-points-v1'"))[0].n).toBe(2);
 });
 it('정규 응시·완료·오답 조회를 유지하지만 포인트 행은 만들지 않는다',async()=>{
  const [saved]=await save([await prepare()]);
  const before=await owner('select * from student_point_events');
  // Local test owner invokes the same normal start RPC; service-role grants in
  // Supabase are not emulated by the minimal PGlite bootstrap.
  const started={run:await rpc<string>('create_quiz_attempt_from_bank',[student,saved.assignmentId])};
  const [run]=await owner('select point_rule_version_snapshot from quiz_attempts where id=$1',[started.run]);expect(run.point_rule_version_snapshot).toBe('no-points-v1');
  const questions=await owner<{id:string;correct_choice_index:number}>('select id,correct_choice_index from quiz_questions where attempt_id=$1 order by order_index',[started.run]);expect(questions).toHaveLength(4);
  for(const [n,q] of questions.entries()){
   await owner("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '20 seconds' where id=$1",[started.run]);
   await owner('select answer_quiz_question_v4($1,$2,$3,$4,$5::smallint,false)',[student,started.run,q.id,'initial',n===0?(q.correct_choice_index+1)%4:q.correct_choice_index]);
  }
  const [completed]=await owner('select status,initial_score::integer,final_score::integer from quiz_attempts where id=$1',[started.run]);expect(completed).toEqual({status:'completed',initial_score:75,final_score:75});
  expect(await owner('select * from student_point_events')).toEqual(before);
  expect(await owner('select * from student_vocab_wrong_events where quiz_attempt_id=$1',[started.run])).toHaveLength(1);
  expect(await rpc('get_student_wrong_word_notebook_page_v2',[student])).toBeTruthy();
  const study=await rpc<{words:{notebookPronunciation:unknown}[]}>('get_student_assignment_study_v1',[student,saved.assignmentId]);expect(study.words).toHaveLength(4);expect(study.words[0].notebookPronunciation).toEqual(voice);
 });
 it('원사전 식별자와 누적 횟수를 잇고 학생/관리자 목록에 실제 원책을 보존한다',async()=>{
  const [saved]=await save([await prepare()]);
  const snapshots=await owner('select * from assignment_question_exam_use_snapshot');
  await owner("select set_config('request.jwt.claim.sub',$1,true)",[admin]);
  const dashboard=await owner<{item:{sourceKind:string;sourceDatasets:unknown[]}}>('select item from private.student_dashboard_read_rows_v2($1,clock_timestamp()) where assignment_id=$2',[student,saved.assignmentId]);
  expect(dashboard[0].item.sourceKind).toBe('notebook');expect(dashboard[0].item.sourceDatasets).toHaveLength(2);
  const history=await owner<{list_item:{sourceKind:string;sourceDatasets:unknown[]}}>('select list_item from private.admin_history_read_rows_v1(clock_timestamp()) where assignment_id=$1',[saved.assignmentId]);
  expect(history[0].list_item.sourceKind).toBe('notebook');expect(history[0].list_item.sourceDatasets).toHaveLength(2);
  // Real Supabase service_role bypasses RLS; mirror that property in this
  // isolated database while still checking the new view's service-role grant.
  await owner('alter role service_role bypassrls');
  expect(await rpc('get_student_wrong_word_notebook_page_v1',[student])).toBeTruthy();
  const started={run:await rpc<string>('create_quiz_attempt_from_bank',[student,saved.assignmentId])};
  const questions=await owner<{id:string;correct_choice_index:number;dictionary_id:string|null}>('select q.id,q.correct_choice_index,i.dictionary_id from quiz_questions q join private.assignment_question_word_identity_v1 i on i.assignment_question_id=q.assignment_question_id where q.attempt_id=$1 order by q.order_index',[started.run]);
  for(const q of questions){await owner("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '20 seconds' where id=$1",[started.run]);await owner('select answer_quiz_question_v4($1,$2,$3,$4,$5::smallint,false)',[student,started.run,q.id,'initial',q.dictionary_id==='word:notebook-fake-1'?(q.correct_choice_index+1)%4:q.correct_choice_index]);}
  const [event]=await owner('select canonical_dictionary_id_snapshot,exam_use_release_id_snapshot,occurrence_id_snapshot from student_vocab_wrong_events where quiz_attempt_id=$1',[started.run]);
  expect(event).toEqual({canonical_dictionary_id_snapshot:'word:notebook-fake-1',exam_use_release_id_snapshot:id(800),occurrence_id_snapshot:'occ:notebook-fake-1'});
  const source=practiceSourceSchema.parse(await rpc('prepare_notebook_assignment_source_v1',[admin,student,selection]));
  const repeated=source.words.filter(w=>w.canonicalDictionaryId==='word:notebook-fake-1');expect(repeated).toHaveLength(1);expect(repeated[0].wrongCount).toBe(2);
  expect(await owner('select * from assignment_question_exam_use_snapshot')).toEqual(snapshots);
  expect(await owner('select * from student_point_events where student_id=$1',[student])).toHaveLength(0);
 });
 it('대표책 밖 단어도 현재 오답 재배정을 막고 취소하면 돌려준다',async()=>{
  for(const [index,who] of [student,other].entries()){
   const run=id(110+index),questions=await owner<{id:string;correct_choice_index:number;order_index:number}>('select id,correct_choice_index,order_index from quiz_questions where attempt_id=$1 order by order_index',[run]);
   for(const q of questions){await owner("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '20 seconds' where id=$1",[run]);await owner('select answer_quiz_question_v4($1,$2,$3,$4,$5::smallint,false)',[who,run,q.id,'initial',(index?q.order_index>=3:q.order_index<=2)?(q.correct_choice_index+1)%4:q.correct_choice_index]);}
  }
  const candidates=(who=student)=>owner<{vocab_entry_id:number}>('select vocab_entry_id from private.list_student_direct_review_candidates_v1($1,$2)',[who,id(5)]);
  const before=await candidates(),others=await candidates(other);expect(before).toHaveLength(2);expect(others).toHaveLength(2);
  const [saved]=await save([await prepare()]);
  expect((await owner('select dataset_id from assignments where id=$1',[saved.assignmentId]))[0].dataset_id).toBe(id(4));
  expect(await candidates()).toHaveLength(0);expect(await candidates(other)).toEqual(others);
  await fails(()=>owner('select private.assert_assignment_words_available_v2($1::uuid[],$2,$3::jsonb)',[[student],id(5),JSON.stringify(before)]),'assignment_word_already_active');
  await owner("update assignment_students set cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='가짜 검사 취소' where assignment_id=$1",[saved.assignmentId,admin]);
  expect(await candidates()).toEqual(before);
  await owner('select private.assert_assignment_words_available_v2($1::uuid[],$2,$3::jsonb)',[[student],id(5),JSON.stringify(before)]);
 });
});
