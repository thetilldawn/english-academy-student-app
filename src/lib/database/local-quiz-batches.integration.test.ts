import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const id=(n:number)=>`a5050000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const student=id(2),assignment=id(10);
describe.sequential("기기 풀이의 회차별 묶음 접수",()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=await createFinalSchemaDatabase();
    // Supabase supplies these auth-schema privileges outside application migrations.
    await db.exec("grant usage on schema auth,extensions to service_role; alter role service_role bypassrls");
    await db.exec(`begin;
      select set_config('request.jwt.claim.sub','${id(1)}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claims','{"role":"authenticated"}',true);
      insert into auth.users(id) values('${id(1)}');
      insert into admin_profiles(user_id,display_name,is_active) values('${id(1)}','Fake admin',true);
      insert into students(id,display_name,status,created_by) values('${student}','Fake ready student','active','${id(1)}'),('${id(3)}','Other fake student','active','${id(1)}');
      insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${id(4)}','local-batch-fake','Fake ready set','Fake',repeat('A',64),4,'ready','${id(1)}');
      insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${id(100)}','${id(4)}','DAY 1','day 1','day',1,1,4);
      insert into assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,timing_mode,
        question_time_limit_seconds,passing_score,status,created_by,retake_allowed)
        values('${assignment}','Fake ready exam','${id(4)}',1,4,4,100,240,'per_question',5,80,'active','${id(1)}',true);
      insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values('${assignment}','${id(4)}','${id(100)}',1,true);
      insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) values('${assignment}','${student}','${id(1)}',clock_timestamp()-interval '1 day');
      insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
        select '${id(4)}',n,'fake'||n,'fake'||n,array['Fake meaning'||n],'Fake meaning'||n,repeat('B',63)||n::text,'${id(100)}',n,'word' from generate_series(1,4)n;
      commit;`);
  },120_000);
  beforeEach(async()=>{await db.exec("begin; select set_config('request.jwt.claim.role','service_role',true)");});
  afterEach(async()=>{await db.exec("rollback;reset role");});
  afterAll(async()=>{await db?.close();});
  async function rpc<T>(name:string,args:unknown[]){
    await db.exec("set local role service_role");
    return (await db.query<{v:T}>(`select public.${name}(${args.map((_,i)=>"$"+(i+1)).join(",")}) v`,args)).rows[0].v;
  }
  async function owner(query:string,args:unknown[]=[]){await db.exec("reset role");return db.query<Record<string,unknown>>(query,args);}
  async function questions(){return (await owner(`select jsonb_agg(jsonb_build_object('vocab_entry_id',id,'order_index',source_row,'direction','english_to_korean',
    'prompt',headword,'choices',jsonb_build_array('Fake meaning1','Fake meaning2','Fake meaning3','Fake meaning4'),'correct_choice_index',source_row-1) order by source_row) plan
    from vocab_entries where dataset_id=$1`,[id(4)])).rows[0].plan;}
  async function prepare(){return rpc<string>("prepare_quiz_attempt_v1",[student,assignment,await questions()]);}
  async function begin(p:string){return rpc<string>("begin_prepared_quiz_v1",[student,p]);}
  async function fails(action:()=>Promise<unknown>,message:string){
    await db.exec("savepoint expected_failure");
    try{await expect(action()).rejects.toThrow(message);}finally{await db.exec("rollback to expected_failure;release expected_failure");}
  }
  async function snapshot(){
    const names=["quiz_attempts","quiz_questions","student_vocab_wrong_events","student_vocab_state","student_point_events","student_point_totals",
      "private.vocabulary_answer_receipts","private.student_vocabulary_meaning_states","private.student_vocabulary_versions",
      "private.vocabulary_question_meaning_versions","private.vocabulary_legacy_state_baselines","private.vocabulary_result_policies","private.vocabulary_phase_results",
      "private.local_quiz_phase_receipts"];
    const result=[];
    for(const name of names) result.push((await owner(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from ${name.includes('.')?name:'public.'+name} t`)).rows);
    return result;
  }
  const device='a'.repeat(64);
  type Plan={attemptId:string;phase:string;planHash:string;startedAt:string;limitMs:number|null;questionLimitMs:number|null;items:Array<{id:string;order:number;correctChoiceIndex:number;contentId:string}>};
  type Prep={preparationId:string;planHash:string;resumeId?:string;protocol:string};
  type Batch={protocol:string;submissionId:string;accepted:Array<{id:string;answerHash:string;sequence:number}>;result:{state:string;finalized:boolean;attempt:{finalScore:number;passed:boolean};phases:unknown[]};retryTargets:string[]};
  async function localPrepare(){return rpc<Prep>('prepare_local_quiz_v1',[student,assignment,device,await questions()]);}
  async function localStart(){const p=await localPrepare();return rpc<Plan>('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]);}
  async function pause(paused=true){await owner('update private.quiz_start_control set paused=$1,changed_at=clock_timestamp() where singleton',[paused]);}
  async function startSnapshot(){
    const rows=await snapshot();
    for(const name of ['quiz_attempt_preparations','local_quiz_preparations','local_quiz_runs','local_quiz_phase_plans'])
      rows.push((await owner(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from private.${name} t`)).rows);
    return rows;
  }
  async function seedRelease(source: string, release: string, approved = true) {
    await owner(`insert into word_index.app_exam_use_release(release_id,release_key,dataset_id,dataset_key,schema_version,
      package_version,source_sha256,candidate_dictionary_version,manifest_content_hash,exam_review_ledger_sha256,wordbook_id,title,target_environment,
      common_dictionary_release_allowed,exam_use_import_allowed,expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json)
      select $2::uuid,'m03-fake:'||$2::text,d.id,d.dataset_key,'1.0',encode(extensions.digest($2::text,'sha256'),'hex'),d.source_sha256,repeat('a',64),repeat('b',64),repeat('c',64),
      'm03-fake','가짜 뜻 승인 검사','preview',false,true,4,4,4,'active','{}' from vocab_datasets d where d.id=$1`, [source, release]);
    await owner(`insert into word_index.app_exam_use_occurrence(release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,
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
    await owner(`insert into word_index.mock_wordbook_identity_review(source_release_id,source_entry_id,source_row_sha256,
      reviewed_headword,reviewed_gloss,lexical_pos,sense_id,review_evidence_sha256)
      select $2,e.id,e.row_sha256,e.headword,e.primary_meaning,'noun','m03-fake-noun-1',repeat('d',64)
      from vocab_entries e where e.dataset_id=$1 and e.source_row=1`, [source, release]);
  }
  async function attachRelease(assignment: string, release: string) {
    await owner(`update assignment_questions q set question_content_sha256=upper(encode(extensions.digest(
      jsonb_build_array(q.direction,q.prompt,q.choices,q.correct_choice_index,q.entry_row_sha256_snapshot,q.headword_snapshot,q.primary_meaning_snapshot)::text,'sha256'),'hex'))
      where q.assignment_id=$1 and q.content_version_id is null`, [assignment]);
    await owner(`with occurrences as (select o.*,jsonb_build_object('dictionaryId',o.dictionary_id,'displayHeadword',o.display_headword,'displayGlossKo',o.display_gloss_ko,
      'displayPronunciationKo',o.display_pronunciation_ko,'pronunciationVariantId',o.pronunciation_variant_id,'audioStatus',o.audio_status,'audioUrl',o.audio_url,
      'soundAudio',o.sound_audio,'rawResponseSha256',o.raw_response_sha256,'listeningEnabled',o.listening_enabled,'reviewStatus',o.display_pronunciation_review_status) pronunciation
      from word_index.app_exam_use_occurrence o where o.release_id=$2)
      insert into assignment_question_exam_use_snapshot(assignment_question_id,assignment_id,dataset_id,vocab_entry_id,release_id,dictionary_id,occurrence_id,sense_id,exam_review_id,
      headword_snapshot,primary_meaning_snapshot,pronunciation_snapshot,choice_dictionary_snapshots,occurrence_content_hash,question_content_sha256,provenance_status)
      select q.id,q.assignment_id,q.dataset_id,q.vocab_entry_id,o.release_id,o.dictionary_id,o.occurrence_id,o.sense_id,o.exam_review_id,o.display_headword,o.display_gloss_ko,o.pronunciation,
      (select jsonb_agg(c.pronunciation||jsonb_build_object('choiceIndex',pick.ord-1,'vocabEntryId',c.vocab_entry_id,'senseId',c.sense_id,'occurrenceContentHash',c.occurrence_content_hash) order by pick.ord)
      from unnest(q.choice_vocab_entry_ids) with ordinality pick(entry_id,ord) join occurrences c on c.vocab_entry_id=pick.entry_id),
      upper(o.occurrence_content_hash),q.question_content_sha256,'reviewed_for_preview_v1'
      from assignment_questions q join occurrences o on o.vocab_entry_id=q.vocab_entry_id and o.dataset_id=q.dataset_id where q.assignment_id=$1`, [assignment, release]);
  }
  async function copySource(dataset:string,unit:string,name:string,alternate:string|null=null) {
    await owner(`insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
      values($1,'m05-cross-'||$3,'Fake source '||$3,'Fake',upper(encode(extensions.digest($3::text,'sha256'),'hex')),4,'ready',$2)`,[dataset,id(1),name]);
    await owner("insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,$2,'DAY 1','day 1','day',1,1,4)",[unit,dataset]);
    await owner(`insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1::uuid,source_row,headword,headword_normalized,case when source_row=1 and $4::text is not null then array[$4::text] else meanings end,
      case when source_row=1 and $4::text is not null then $4::text else primary_meaning end,
      upper(encode(extensions.digest($1::uuid::text||'/'||source_row,'sha256'),'hex')),$2,position_in_unit,entry_type from vocab_entries where dataset_id=$3`,[dataset,unit,id(4),alternate]);
  }
  async function approvedBank(n:number,dataset:string,unit:string,release:string,retry=true) {
    const bank=id(n);
    await owner(`insert into assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,timing_mode,
      question_time_limit_seconds,passing_score,status,created_by,retake_allowed,range_basis,question_bank_version,retry_enabled,retry_passing_score,question_order_mode)
      values($1,'Fake approved local exam',$2,1,4,4,100,240,'none',null,80,'active',$3,true,'units',1,$4,case when $4 then 80::smallint else null end,'fixed')`,[bank,dataset,id(1),retry]);
    await owner("insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values($1,$2,$3,1,true)",[bank,dataset,unit]);
    await owner("insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) values($1,$2,$3,clock_timestamp()-interval '1 day')",[bank,student,id(1)]);
    await owner(`insert into assignment_questions(assignment_id,dataset_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,
      headword_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids,entry_row_sha256_snapshot)
      select $1,$2,e.id,e.source_row,'english_to_korean',e.headword,(select jsonb_agg(primary_meaning order by source_row) from vocab_entries where dataset_id=$2),
      (e.source_row-1)::smallint,e.headword,e.primary_meaning,(select array_agg(id order by source_row) from vocab_entries where dataset_id=$2),e.row_sha256
      from vocab_entries e where e.dataset_id=$2`,[bank,dataset]);
    await attachRelease(bank,release); await owner("select private.finalize_assignment_question_body_refs_v1($1)",[bank]); return bank;
  }
  async function startBank(bank:string) {
    const p=await rpc<Prep>('prepare_local_quiz_v1',[student,bank,device,null]);
    const plan=await rpc<Plan>('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]);
    expect(plan.attemptId).toBe(p.preparationId); return plan;
  }
  const firstWrong=(p:Plan)=>answers(p).map((a,i)=>i===0?{...a,choice:(a.choice+1)%4}:a);
  type Identity={identityKind:string;wordKey:string;meaningKey:string};
  type MistakePage={totalCount:number;items:Array<{currentWrongCount:number;lifetimeWrongCount:number;meanings:Array<{
    meaningKey:string;currentWrongCount:number;lifetimeWrongCount:number;unresolved:boolean;sources:Array<{datasetId:string;currentWrongCount:number}>}>}>};
  async function identity(question:string){return (await owner("select private.quiz_vocabulary_meaning_v1($1) value",[question])).rows[0].value as Identity;}
  async function meaningState(key:string){return (await owner("select unresolved,current_wrong_count,lifetime_wrong_count from private.student_vocabulary_meaning_states where student_id=$1 and meaning_key=$2",[student,key])).rows[0];}
  async function wordPage(view='current'){return rpc<MistakePage>('get_student_vocabulary_mistake_page_v1',[student,JSON.stringify({query:'fake1',view}),null]);}
  function answers(p:Plan,correct=()=>true){return p.items.map((q,i)=>({id:q.id,order:i+1,kind:'answer',choice:correct()?q.correctChoiceIndex:(q.correctChoiceIndex+1)%4,openedMs:i*100,elapsedMs:i*100}));}
  async function batch(p:Plan,list=answers(p),key=id(800),reason='answered'){
    return rpc<Batch>('submit_local_quiz_phase_v1',[student,p.attemptId,p.phase,device,p.planHash,key,list,{elapsedMs:list.at(-1)!.elapsedMs,reason}]);
  }
  async function aged(p:Plan,seconds:number){
    // Fixture-only clock placement. Recreate the immutable plan with its real
    // signing function; no runtime bypass or changed migration is involved.
    await owner('alter table private.local_quiz_phase_plans disable trigger local_quiz_plans_immutable');
    await owner('delete from private.local_quiz_phase_plans where attempt_id=$1',[p.attemptId]);
    await owner('alter table private.local_quiz_phase_plans enable trigger local_quiz_plans_immutable');
    await owner("update quiz_attempts set started_at=started_at-make_interval(secs=>$2),current_question_started_at=current_question_started_at-make_interval(secs=>$2),deadline_at=deadline_at-make_interval(secs=>$2) where id=$1",[p.attemptId,seconds]);
    await owner("select private.create_local_quiz_phase_plan_v1($1,'initial')",[p.attemptId]);
    return rpc<Plan>('read_local_quiz_plan_v1',[student,p.attemptId,device,'initial']);
  }
  it.each([false,true])('시작은 한번만 고정하고 중지 뒤에도 기존 시작 재전송을 보존한다: 중지=%s',async paused=>{
    const p=await localPrepare();
    await fails(()=>begin(p.preparationId),'local_quiz_batch_required');
    await fails(()=>rpc('begin_local_quiz_v1',[student,p.preparationId,'b'.repeat(64),p.planHash]),'local_quiz_preparation_conflict');
    const a=await rpc<Plan>('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]);
    if(paused) await pause();
    const same=await rpc<Plan>('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]);
    expect(same.startedAt).toBe(a.startedAt);expect(same.planHash).toBe(a.planHash);expect(same.items).toEqual(a.items);
    expect(a.items).toHaveLength(4);expect(a.items.every(x=>x.contentId)).toBe(true);expect(a.attemptId).toBe(p.preparationId);
    expect((await localPrepare()).resumeId).toBe(a.attemptId);
    await fails(async()=>rpc('prepare_local_quiz_v1',[student,assignment,'b'.repeat(64),await questions()]),'local_quiz_device_required');
  });
  it('같은 종료 묶음은 점수/오답/포인트를 한번만 반영하고 다른 내용은 충돌한다',async()=>{
    const p=await localStart(),list=answers(p),result=await batch(p,list);
    expect(result.result).toMatchObject({state:'completed',finalized:true,attempt:{finalScore:100,passed:true}});
    expect(result.accepted).toHaveLength(4);
    await owner('set constraints all immediate');
    const prior=await snapshot();expect(await batch(p,list)).toEqual(result);expect(await snapshot()).toEqual(prior);
    await fails(()=>batch(p,[{...list[0],choice:(list[0].choice+1)%4},...list.slice(1)]),'local_quiz_submission_conflict');
    expect((await owner('select count(*)::int n from private.vocabulary_answer_receipts where attempt_id=$1',[p.attemptId])).rows[0].n).toBe(4);
    expect((await owner('select count(*)::int n from student_point_events where quiz_attempt_id=$1',[p.attemptId])).rows[0].n).toBe(4);
  });
  it('누락/중복/잘못된 시간과 정답 변경을 쓰기 전에 거절한다',async()=>{
    const p=await localStart(),list=answers(p),before=await snapshot();
    await fails(()=>batch(p,list.slice(1)),'local_quiz_answers_incomplete');
    await fails(()=>batch(p,[list[0],{...list[1],id:list[0].id},...list.slice(2)]),'local_quiz_answer_invalid');
    await fails(()=>batch(p,[{...list[0],elapsedMs:5001},...list.slice(1)]),'local_quiz_time_invalid');
    expect(await snapshot()).toEqual(before);
  });
  it('기기답은 기존 답/피드백/재시험 호출로 바꾸거나 자동 만료시킬 수 없다',async()=>{
    const p=await localStart();
    await fails(()=>rpc('answer_quiz_question_v4',[student,p.attemptId,p.items[0].id,'initial',0,false]),'local_quiz_batch_required');
    await fails(()=>rpc('start_quiz_retry_v2',[student,p.attemptId]),'local_quiz_batch_required');
    await fails(()=>rpc('start_quiz_retry',[student,p.attemptId]),'local_quiz_batch_required');
    await fails(()=>rpc('resume_quiz_after_feedback_v1',[student,p.attemptId,p.items[0].id,'initial']),'local_quiz_batch_required');
    await fails(()=>rpc('resume_quiz_after_feedback_v2',[student,p.attemptId,p.items[0].id,'initial',100]),'local_quiz_batch_required');
    await owner("update quiz_attempts set deadline_at=started_at+interval '1 millisecond' where id=$1",[p.attemptId]);
    expect(await rpc('expire_quiz_attempt',[student,p.attemptId])).toMatchObject({expired:false,completed:false,awaitingLocalSubmission:true});
    await owner("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
    expect(await rpc('finalize_quiz_attempt_if_stale',[p.attemptId])).toBe(false);
    expect((await batch(p)).result.attempt).toMatchObject({finalScore:100,passed:true});
  });
  it.each([false,true])('최초 오답과 재시험은 같은 공용판과 최초 결과를 쓴다: 새 시작 중지=%s',async paused=>{
    const p=await localStart();let n=0;
    if(paused) await pause();
    const first=await batch(p,answers(p,()=>n++<2));
    expect(first.result.state).toBe('retry_waiting');expect(first.retryTargets).toHaveLength(2);
    const retry=await rpc<Plan>('begin_local_quiz_retry_v1',[student,p.attemptId,device]);
    expect(retry.items.map(x=>x.id)).toEqual(first.retryTargets);
    expect(retry.items.map(x=>x.contentId)).toEqual(p.items.slice(2).map(x=>x.contentId));
    const result=await batch(retry,answers(retry),id(801));
    expect(result.result.attempt).toMatchObject({finalScore:100,passed:true});
    expect(result.result.phases[0]).toEqual(first.result.phases[0]);
    expect((await owner('select count(*)::int n from private.vocabulary_answer_receipts where attempt_id=$1',[p.attemptId])).rows[0].n).toBe(6);
  });
  it('학생과 직접 DB 역할 경계를 지키며 서비스 역할도 내부 표에 접근할 수 없다',async()=>{
    const p=await localStart();
    await fails(()=>rpc('read_local_quiz_plan_v1',[id(3),p.attemptId,device,'initial']),'attempt_not_found');
    await fails(()=>rpc('read_local_quiz_plan_v1',[student,p.attemptId,'b'.repeat(64),'initial']),'local_quiz_device_required');
    for(const role of ['anon','authenticated','service_role']){
      await db.exec('reset role;savepoint access_failure;set local role '+role);
      try{await expect(db.query('select * from private.local_quiz_phase_plans')).rejects.toThrow('permission denied');}
      finally{await db.exec('rollback to access_failure;release access_failure');}
      await db.exec('reset role;savepoint access_failure;set local role '+role);
      try{await expect(db.query('select * from private.local_quiz_runs')).rejects.toThrow('permission denied');}
      finally{await db.exec('rollback to access_failure;release access_failure');}
      if(role!=='service_role'){
        await db.exec('reset role;savepoint access_failure;set local role '+role);
        try{await expect(db.query('select private.assert_legacy_quiz_protocol_v1($1)',[p.attemptId])).rejects.toThrow('permission denied');}
        finally{await db.exec('rollback to access_failure;release access_failure');}
      }
    }
  });
  it('최초 통과 기준을 넘으면 오답이 있어도 재시험 대기로 남기지 않는다',async()=>{
    await owner('update assignments set passing_score=75 where id=$1',[assignment]);
    const p=await localStart();let n=0;
    const result=await batch(p,answers(p,()=>n++<3));
    expect(result.result).toMatchObject({state:'completed',finalized:true,attempt:{finalScore:75,passed:true}});
    expect(result.retryTargets).toEqual([]);
    expect((await owner('select array_agg(unresolved_wrong_count order by vocab_entry_id) values from student_vocab_state where student_id=$1',[student])).rows[0].values).toEqual([0,0,0,1]);
  });

  it.each([5,8,10,17,20,600])('기존 %i초 문항 제한을 그대로 시작한다',async seconds=>{
    await owner('update assignments set question_time_limit_seconds=$2 where id=$1',[assignment,seconds]);
    expect((await localStart()).questionLimitMs).toBe(seconds*1000);
  });
  it.each([false,true])('기한 지난 시험의 이틀 뒤 답을 한번만 접수한다: 새 시작 중지=%s',async paused=>{
    const prepared=await localPrepare(); const original=await rpc<Plan>('begin_local_quiz_v1',[student,prepared.preparationId,device,prepared.planHash]);
    const p=await aged(original,2*24*3600);
    if(paused) await pause();
    expect((await owner('select deadline_at<transaction_timestamp() past from quiz_attempts where id=$1',[p.attemptId])).rows[0].past).toBe(true);
    const before=await snapshot();
    await owner("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
    expect(await rpc('finalize_quiz_attempt_if_stale',[p.attemptId])).toBe(false);
    expect(await rpc('expire_quiz_attempt',[student,p.attemptId])).toMatchObject({awaitingLocalSubmission:true});
    await owner('select private.run_stale_quiz_attempt_maintenance_v1(10,25,1000)');
    expect(await snapshot()).toEqual(before);
    expect(await prepare()).toBe(p.attemptId);
    expect((await rpc<Plan>('begin_local_quiz_v1',[student,prepared.preparationId,device,prepared.planHash])).planHash).toBe(p.planHash);
    const result=await batch(p); expect(result.result.attempt.passed).toBe(true); expect(await batch(p)).toEqual(result);
  });
  it('정답 선택 없는 문항 시간초과도 포인트와 답 접수에서 시간초과로 기록한다',async()=>{
    await owner('update assignments set retry_enabled=false,retry_passing_score=null,passing_score=50 where id=$1',[assignment]);
    const p=await aged(await localStart(),30);const list=answers(p);
    list[0]={...list[0],choice:null as unknown as number,kind:'timeout',elapsedMs:5000};
    for(let n=1;n<4;n++)list[n]={...list[n],openedMs:5000+n*100,elapsedMs:5000+n*100};
    const result=await batch(p,list);expect(result.result.attempt).toMatchObject({finalScore:75,passed:true});
    await owner('set constraints all immediate');
    expect((await owner("select outcome from student_point_events where quiz_attempt_id=$1 and quiz_question_id=$2",[p.attemptId,p.items[0].id])).rows[0].outcome).toBe('timeout');
    expect((await owner("select outcome from private.vocabulary_answer_receipts where quiz_question_id=$1",[p.items[0].id])).rows[0].outcome).toBe('timeout');
  });
  it('임의로 문항을 늦게 열어 제한시간을 늘린 답안은 쓰기 전에 거절한다',async()=>{
    const p=await aged(await localStart(),40);const list=answers(p).map(a=>({...a,openedMs:a.openedMs+30000,elapsedMs:a.elapsedMs+30000}));
    const before=await snapshot();await fails(()=>batch(p,list),'local_quiz_time_invalid');expect(await snapshot()).toEqual(before);
  });
  it('이미 만든 구형 배열 준비는 ID와 본문을 바꾸지 않고 기존 방식으로 이어간다',async()=>{
    const prepared=id(99);
    await owner("insert into private.quiz_attempt_preparations(id,student_id,assignment_id,kind,request_key,fingerprint,plan) select $1,$2,a.id,'initial',a.id::text,private.quiz_preparation_fingerprint(a),(select jsonb_agg(q||jsonb_build_object('id',gen_random_uuid())) from jsonb_array_elements($4::jsonb)q) from assignments a where a.id=$3",[prepared,student,assignment,JSON.stringify(await questions())]);
    const before=(await owner('select plan from private.quiz_attempt_preparations where id=$1',[prepared])).rows;
    const local=await localPrepare();expect(local).toEqual({protocol:'legacy',resumeId:prepared});
    expect((await owner('select plan from private.quiz_attempt_preparations where id=$1',[prepared])).rows).toEqual(before);
    expect((await owner('select count(*)::int n from private.local_quiz_preparations')).rows[0].n).toBe(0);
    expect(await begin(prepared)).toBe(prepared);
    await pause();
    expect(await begin(prepared)).toBe(prepared);
  });
  it.each(['direct','bank','prepared','local'] as const)('중지 중 새 %s 시작만 거절하고 준비/시계/문항을 남기지 않는다',async kind=>{
    const q=await questions();let run:()=>Promise<unknown>;
    if(kind==='bank'){
      await seedRelease(id(4),id(51));const bank=await approvedBank(52,id(4),id(100),id(51));
      run=()=>rpc('create_quiz_attempt_from_bank',[student,bank]);
    } else if(kind==='direct') run=()=>rpc('create_quiz_attempt',[student,assignment,q]);
    else if(kind==='prepared'){const p=await prepare();run=()=>begin(p);}
    else {const p=await localPrepare();run=()=>rpc('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]);}
    await pause();const before=await startSnapshot();
    await fails(run,'quiz_new_attempts_paused');expect(await startSnapshot()).toEqual(before);
    await pause(false);await run();
    expect((await owner('select count(*)::int n from quiz_attempts')).rows[0].n).toBe(1);
    expect((await owner('select count(*)::int n from quiz_questions')).rows[0].n).toBe(4);
  });
  it('설정 누락은 새 시작을 거절하고 앱 역할에는 읽기/변경 권한이 없다',async()=>{
    for(const role of ['anon','authenticated','service_role']){
      for(const command of ['select * from private.quiz_start_control','update private.quiz_start_control set paused=false']){
        await owner('savepoint control_access');await db.exec('set local role '+role);
        try{await expect(db.exec(command)).rejects.toThrow('permission denied');}
        finally{await db.exec('rollback to control_access;release control_access;reset role');}
      }
    }
    const p=await localPrepare();await owner('delete from private.quiz_start_control');
    const before=await startSnapshot();
    await fails(()=>rpc('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]),'quiz_start_control_unavailable');
    expect(await startSnapshot()).toEqual(before);
  });
  it('전체 답 순서가 정상이어도 문항별 제한보다 늦은 선택은 거절한다',async()=>{
    const p=await aged(await localStart(),30),list=answers(p);
    for(let i=0;i<list.length;i++)list[i]={...list[i],openedMs:i===0?0:5001+i*100,elapsedMs:5001+i*100};
    const before=await snapshot();await fails(()=>batch(p,list),'local_quiz_time_invalid');expect(await snapshot()).toEqual(before);
  });
  it('전체 시간이 끝나면 남은 문항을 미응답으로 확정하고 이틀 뒤도 같은 결과로 접수한다',async()=>{
    await owner("update assignments set timing_mode='total',question_time_limit_seconds=null where id=$1",[assignment]);
    const p=await aged(await localStart(),2*86400),list=answers(p);
    list[0]={...list[0],elapsedMs:239950};
    for(let i=1;i<list.length;i++)list[i]={...list[i],kind:'unanswered',choice:null as unknown as number,openedMs:240000,elapsedMs:240000};
    const result=await batch(p,list,id(804),'deadline');expect(result.result.finalized).toBe(true);expect(result.result.attempt.passed).toBe(false);
    expect(result.accepted).toHaveLength(4);expect(result.retryTargets).toEqual([]);
    expect((await owner("select array_agg(outcome order by server_sequence) values from private.vocabulary_answer_receipts where attempt_id=$1",[p.attemptId])).rows[0].values).toEqual(['correct','unanswered','unanswered','unanswered']);
    const final=await snapshot();expect(await batch(p,list,id(804),'deadline')).toEqual(result);expect(await snapshot()).toEqual(final);
  });
  it('마지막 접수 저장 실패는 답·현재오답·기록·포인트를 함께 되돌리고 같은 제출을 재시도한다',async()=>{
    const p=await localStart(),list=answers(p);await owner('set constraints all immediate');const before=await snapshot();
    await owner("create function private.m05_fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'fake_receipt_failure'; end; $$");
    await owner('create trigger m05_fail_receipt before insert on private.local_quiz_phase_receipts for each row execute function private.m05_fail_receipt()');
    await fails(()=>batch(p,list),'fake_receipt_failure');expect(await snapshot()).toEqual(before);
    await owner('drop trigger m05_fail_receipt on private.local_quiz_phase_receipts');await owner('drop function private.m05_fail_receipt()');
    const result=await batch(p,list),after=await snapshot();expect(result.result.finalized).toBe(true);expect(await batch(p,list)).toEqual(result);expect(await snapshot()).toEqual(after);
  });
  it('재시험 시작·접수 반복과 뒤늦은 초기 재전송이 확정 결과를 바꾸지 않는다',async()=>{
    const p=await localStart(),initialAnswers=answers(p,()=>false);const initial=await batch(p,initialAnswers);
    const retry=await rpc<Plan>('begin_local_quiz_retry_v1',[student,p.attemptId,device]);const repeated=await rpc<Plan>('begin_local_quiz_retry_v1',[student,p.attemptId,device]);
    expect(repeated.startedAt).toBe(retry.startedAt);expect(repeated.planHash).toBe(retry.planHash);expect(repeated.items).toEqual(retry.items);
    const retryAnswers=answers(retry);const result=await batch(retry,retryAnswers,id(805));await owner('set constraints all immediate');const after=await snapshot();
    expect(await batch(p,initialAnswers)).toEqual(initial);expect(await batch(retry,retryAnswers,id(805))).toEqual(result);expect(await snapshot()).toEqual(after);
  });
  it('다른 학생·다른 기기·차단된 학생은 원래 제출 건도 읽거나 쓸 수 없다',async()=>{
    const p=await localStart(),list=answers(p),args=[p.attemptId,p.phase,device,p.planHash,id(806),list,{elapsedMs:300,reason:'answered'}];
    await fails(()=>rpc('submit_local_quiz_phase_v1',[id(3),...args]),'attempt_not_found');
    await fails(()=>rpc('submit_local_quiz_phase_v1',[student,p.attemptId,p.phase,'b'.repeat(64),p.planHash,id(806),list,{elapsedMs:300,reason:'answered'}]),'local_quiz_device_required');
    await owner("update students set status='blocked' where id=$1",[student]);
    await fails(()=>rpc('submit_local_quiz_phase_v1',[student,...args]),'student_not_found');
    expect((await owner('select count(*)::int n from private.local_quiz_phase_receipts')).rows[0].n).toBe(0);
  });
  it('미리 읽기는 준비/응시/답/포인트를 만들지 않는다',async()=>{
    const before=await snapshot();expect(await rpc('read_local_quiz_materials_v1',[student,assignment])).toBeNull();expect(await snapshot()).toEqual(before);
    expect((await owner('select count(*)::int n from private.quiz_attempt_preparations where student_id=$1',[student])).rows[0].n).toBe(0);
  });
  it('실제 은행의 공용 자료 미리 읽기는 내용 참조만 반환하고 학생 기록을 만들지 않는다',async()=>{
    await seedRelease(id(4),id(430)); const bank=await approvedBank(410,id(4),id(100),id(430));
    const before=await snapshot(); const result=await rpc<{items:Array<{content_version_id:string}>}>('read_local_quiz_materials_v1',[student,bank]);
    expect(result.items).toHaveLength(4);expect(result.items.every(q=>q.content_version_id)).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect((await owner("select count(*)::int n from private.quiz_attempt_preparations where student_id=$1",[student])).rows[0].n).toBe(0);
  });
  it('A/B 같은 뜻은 한 카드에 합산하고 정답 재시험은 그 뜻만 해결한다',async()=>{
    const datasetB=id(420),unitB=id(421),datasetC=id(422),unitC=id(423);
    await copySource(datasetB,unitB,'b');await copySource(datasetC,unitC,'c','Fake alternate meaning1');
    await seedRelease(id(4),id(430));await seedRelease(datasetB,id(431));await seedRelease(datasetC,id(432));
    const bankA=await approvedBank(410,id(4),id(100),id(430)),bankB=await approvedBank(411,datasetB,unitB,id(431));
    const bankC=await approvedBank(412,datasetC,unitC,id(432),false),solveBank=await approvedBank(413,id(4),id(100),id(430));
    const a=await startBank(bankA),b=await startBank(bankB);
    const ai=await identity(a.items[0].id),bi=await identity(b.items[0].id);
    expect(ai).toMatchObject({identityKind:'reviewed-meaning-v1',wordKey:'dictionary:word:m03-shared-1'});
    expect(bi.meaningKey).toBe(ai.meaningKey);
    expect((await identity(a.items[1].id)).meaningKey).not.toBe((await identity(b.items[1].id)).meaningKey);
    const aAnswers=firstWrong(a),aReceipt=await batch(a,aAnswers,id(840));expect(aReceipt.retryTargets).toEqual([a.items[0].id]);
    const ar=await rpc<Plan>('begin_local_quiz_retry_v1',[student,a.attemptId,device]);await batch(ar,answers(ar,()=>false),id(841));
    const brc=await batch(b,firstWrong(b),id(842));expect(brc.retryTargets).toEqual([b.items[0].id]);
    const br=await rpc<Plan>('begin_local_quiz_retry_v1',[student,b.attemptId,device]);await batch(br,answers(br,()=>false),id(843));
    const combined=await wordPage();expect(combined.totalCount).toBe(1);expect(combined.items[0]).toMatchObject({currentWrongCount:4,lifetimeWrongCount:4});
    expect(combined.items[0].meanings).toHaveLength(1);expect(combined.items[0].meanings[0].sources).toHaveLength(2);
    expect(combined.items[0].meanings[0].sources).toEqual(expect.arrayContaining([
      expect.objectContaining({datasetId:id(4),currentWrongCount:2}),expect.objectContaining({datasetId:datasetB,currentWrongCount:2})]));
    const c=await startBank(bankC),ci=await identity(c.items[0].id);
    expect(ci.wordKey).toBe(ai.wordKey);expect(ci.meaningKey).not.toBe(ai.meaningKey);
    expect((await batch(c,firstWrong(c),id(844))).retryTargets).toEqual([]);
    const two=await wordPage();expect(two.totalCount).toBe(1);expect(two.items[0].currentWrongCount).toBe(5);expect(two.items[0].meanings).toHaveLength(2);
    const solve=await startBank(solveBank);await batch(solve,firstWrong(solve),id(845));
    expect(await meaningState(ai.meaningKey)).toMatchObject({unresolved:true,current_wrong_count:5,lifetime_wrong_count:5});
    const sr=await rpc<Plan>('begin_local_quiz_retry_v1',[student,solve.attemptId,device]),sa=answers(sr),solved=await batch(sr,sa,id(846));
    expect(solved.result.attempt).toMatchObject({finalScore:100,passed:true});
    expect(await meaningState(ai.meaningKey)).toMatchObject({unresolved:false,current_wrong_count:0,lifetime_wrong_count:5});
    expect(await meaningState(ci.meaningKey)).toMatchObject({unresolved:true,current_wrong_count:1,lifetime_wrong_count:1});
    const current=await wordPage();expect(current.totalCount).toBe(1);expect(current.items[0]).toMatchObject({currentWrongCount:1,lifetimeWrongCount:6});
    expect(current.items[0].meanings).toHaveLength(1);expect(current.items[0].meanings[0].meaningKey).toBe(ci.meaningKey);
    expect((await wordPage('history')).items[0].meanings).toEqual(expect.arrayContaining([
      expect.objectContaining({meaningKey:ai.meaningKey,unresolved:false,currentWrongCount:0,lifetimeWrongCount:5}),
      expect.objectContaining({meaningKey:ci.meaningKey,unresolved:true,currentWrongCount:1,lifetimeWrongCount:1})]));
    await owner('set constraints all immediate');const before=await snapshot();
    expect(await batch(a,aAnswers,id(840))).toEqual(aReceipt);expect(await batch(sr,sa,id(846))).toEqual(solved);expect(await snapshot()).toEqual(before);
  });

});
