import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const id=(n:number)=>`a6060000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const student=id(2),assignment=id(10);
describe.sequential("운영 기록 보관기간과 시험 준비 보호",()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=await createFinalSchemaDatabase();
    await db.exec("insert into cron.job(jobid,jobname,schedule,command) overriding system value values(777,'retention-fake','* * * * *','select 777'); insert into private.operational_retention_jobs select jobid,jobname,schedule,database,username,command from cron.job where jobid=777");
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
  type Preview={kind:string;cutoff:string;policyHash:string;after:string;limit:number;candidateCount:number;hasMore:boolean;actions:{key:string;action:string}[]};
  type Result={removed:number;verified:number;compacted:number;scanned:number;nextCursor:string;hasMore:boolean;skipped:number};
  const cutoff='2026-09-01T00:00:00.000Z';
  async function preview(kind:string,after='',limit=250,at=cutoff){return (await owner('select private.preview_operational_retention_v1($1,$2::timestamptz,$3,$4) v',[kind,at,after,limit])).rows[0].v as Preview;}
  async function run(p:Preview){return (await owner('select private.run_operational_retention_batch_v1($1::jsonb) v',[JSON.stringify(p)])).rows[0].v as Result;}
  async function cron(n:number,status:string,age:string,command='select 777'){
    await owner(`insert into cron.job_run_details(jobid,runid,database,username,command,status,start_time,end_time)
      values(777,$1,current_database(),'postgres',$2,$3,$4::timestamptz-interval '50 days',$4::timestamptz-$5::interval)`,[n,command,status,cutoff,age]);
  }
  async function expirePrep(p:string){await owner('update private.quiz_attempt_preparations set expires_at=$2::timestamptz-interval \'24 hours\' where id=$1',[p,cutoff]);}
  it('succeeded7일·failed30일 경계, 실행중·명령다름을 보존한다',async()=>{
    await cron(901,'succeeded','7 days'); await cron(902,'succeeded','6 days 23:59:59');
    await cron(903,'failed','30 days'); await cron(904,'failed','29 days 23:59:59');
    await cron(905,'running','40 days');await cron(906,'succeeded','40 days','select another_job');
    const p=await preview('cron');expect(p.candidateCount).toBe(2);expect((await run(p)).removed).toBe(2);
    expect((await owner('select runid from cron.job_run_details order by runid')).rows.map(x=>x.runid)).toEqual([902,904,905,906]);
  });
  it('후속 DELETE 전에 작업 명령이 바뀌면 남은 상세를 보존하고 재순회한다',async()=>{
    await cron(901,'succeeded','8 days');await cron(902,'succeeded','8 days');
    await owner('select 1');
    await db.exec(`create function public.fake_retention_job_change() returns trigger language plpgsql as $$
      begin update cron.job set command='select changed_during_batch' where jobid=777;return old;end $$;
      create trigger fake_retention_job_change after delete on cron.job_run_details
        for each row when(old.runid=901) execute function public.fake_retention_job_change();`);
    const result=await run(await preview('cron'));
    expect(result.removed).toBe(1);expect(result.skipped).toBe(1);
    expect((result as Result & {requiresRescan:boolean}).requiresRescan).toBe(true);
    expect((await owner('select runid from cron.job_run_details')).rows.map(x=>x.runid)).toEqual([902]);
  });
  it('거래 전체의 오래된 조회 시점을 재사용하는 격리수준을 거절한다',async()=>{
    const p=await preview('cron');
    await db.exec('rollback;begin isolation level repeatable read');
    await fails(()=>run(p),'retention_isolation_invalid');
  });
  it('보존 표시와 변경된 실제 작업은 정리하지 않는다',async()=>{
    await cron(901,'succeeded','8 days');await owner("select private.set_operational_retention_hold_v1('cron','901','fake investigation')");
    expect((await preview('cron')).candidateCount).toBe(0);
    await owner("select private.set_operational_retention_hold_v1('cron','901',null)");
    await owner("update cron.job set command='select changed' where jobid=777");expect((await preview('cron')).candidateCount).toBe(0);
  });
  it('미리보기 뒤 보존 표시를 붙여도 실행이 보호한다',async()=>{
    await cron(901,'succeeded','8 days');const p=await preview('cron');
    await owner("select private.set_operational_retention_hold_v1('cron','901','hold after preview')");
    expect((await run(p)).removed).toBe(0);
  });
  it('삭제된 기록에 보존 성공이라고 응답하지 않는다',async()=>{
    await cron(901,'succeeded','8 days');await run(await preview('cron'));
    await fails(()=>owner("select private.set_operational_retention_hold_v1('cron','901','too late')"),'retention_target_missing');
  });
  it('24시간 지난 로그인 실패만 정리하며 성공·15분 제한창을 보존한다',async()=>{
    await owner(`insert into student_login_attempts(id,code_lookup_hmac,ip_hash,was_successful,attempted_at) overriding system value values
      (901,repeat('A',64),repeat('B',64),false,$1::timestamptz-interval '24 hours'),(902,repeat('A',64),repeat('B',64),false,$1::timestamptz-interval '23:59:59'),
      (903,repeat('A',64),repeat('B',64),false,$1::timestamptz-interval '10 minutes'),(904,repeat('A',64),repeat('B',64),true,$1::timestamptz-interval '30 days')`,[cutoff]);
    expect((await run(await preview('login_failures'))).removed).toBe(1);
    expect((await owner('select id from student_login_attempts order by id')).rows.map(x=>x.id)).toEqual([902,903,904]);
  });
  it('세션의 실제 만료·폐기 뒤7일과 활성 세션을 구별한다',async()=>{
    await owner(`insert into student_sessions(id,student_id,token_hash,code_generation,issued_at,last_seen_at,expires_at,revoked_at)
      select x.id::uuid,$1,upper(md5(x.id)||md5(x.id)),1,$2::timestamptz-interval '20 days',$2::timestamptz,
      $2::timestamptz+x.expiry::interval,case when x.revocation is null then null else $2::timestamptz+x.revocation::interval end
      from(values($3,'-7 days',null),($4,'-6 days 23:59:59',null),($5,'60 days',null),($6,'60 days','-7 days'),($7,'60 days','-6 days'))x(id,expiry,revocation)`,
      [student,cutoff,id(901),id(902),id(903),id(904),id(905)]);
    expect((await run(await preview('sessions'))).removed).toBe(2);
    expect((await owner('select id from student_sessions order by id')).rows.map(x=>x.id)).toEqual([id(902),id(903),id(905)]);
  });
  it('250보다 작은 배치 재개·같은 배치 재전송·미리보기 불변을 확인한다',async()=>{
    for(let n=901;n<=905;n++)await cron(n,'succeeded','8 days');
    const p=await preview('cron','',2);expect(p.candidateCount).toBe(2);expect(p.hasMore).toBe(true);
    expect((await owner('select count(*) n from private.operational_retention_state')).rows[0].n).toBe(0);
    const first=await run(p);expect(first.removed).toBe(2);expect(await run(p)).toEqual(first);
    const second=await run(await preview('cron',first.nextCursor,2));expect(second.removed).toBe(2);
    const last=await run(await preview('cron',second.nextCursor,2));expect(last.removed).toBe(1);expect(last.hasMore).toBe(false);
    expect((await owner('select count(*) n from private.operational_retention_state')).rows[0].n).toBe(1);
  });
  it('잘못된 상한/제한량/권한과 정책 변경을 거절한다',async()=>{
    await fails(()=>preview('cron','',0),'retention_input_invalid');await fails(()=>preview('cron','',1001),'retention_input_invalid');
    await fails(()=>preview('cron','',250,'9999-01-01'),'retention_input_invalid');
    const p=await preview('cron');await owner('update private.operational_retention_policy set version=version+1');
    await fails(()=>run(p),'retention_policy_changed');
    for(const role of ['anon','authenticated','service_role'])await fails(async()=>{await db.exec(`set local role ${role}`);return db.query("select private.preview_operational_retention_v1('cron')");},'permission denied');
  });
  it('만료한 준비만24시간 후 작은 확인으로 바꾸고 옛 시작을 차단한다',async()=>{
    const p=await prepare();await expirePrep(p);const before=await snapshot();
    expect((await run(await preview('preparations'))).removed).toBe(1);expect(await snapshot()).toEqual(before);
    await fails(()=>begin(p),'preparation_expired');
    expect((await owner('select id,request_key from private.quiz_preparation_expirations where id=$1',[p])).rows).toHaveLength(1);
    const next=await prepare();expect(next).not.toBe(p);await fails(()=>begin(p),'preparation_expired');expect(await begin(next)).toBe(next);
  });
  it('local 준비 만료는 기기 진행이나 답 없이 시작 요청만 만료시킨다',async()=>{
    const p=await rpc<{preparationId:string;planHash:string}>('prepare_local_quiz_v1',[student,assignment,'a'.repeat(64),await questions()]);
    await expirePrep(p.preparationId);expect((await run(await preview('preparations'))).removed).toBe(1);
    await fails(()=>rpc('begin_local_quiz_v1',[student,p.preparationId,'a'.repeat(64),p.planHash]),'preparation_expired');
    expect((await owner('select count(*) n from private.local_quiz_runs')).rows[0].n).toBe(0);
  });
  it('자율연습 동일 요청 find/prepare/직접시작을 재생성하지 않는다',async()=>{
    const key=id(505),hash='a'.repeat(64),p=id(506);
    await owner(`insert into private.quiz_attempt_preparations(id,student_id,kind,request_key,request_hash,fingerprint,plan,expires_at)
      values($1,$2,'practice',$3,$4,$4,'{"questions":[]}',$5::timestamptz-interval '24 hours')`,[p,student,key,hash,cutoff]);
    expect((await run(await preview('preparations'))).removed).toBe(1);
    await fails(()=>rpc('find_word_practice_preparation_v1',[student,key,hash]),'practice_source_changed');
    await fails(()=>rpc('find_word_practice_preparation_v1',[student,key,'b'.repeat(64)]),'practice_request_conflict');
    await fails(()=>rpc('prepare_word_practice_start_v1',[student,key,hash,{}, {},hash,[]]),'practice_source_changed');
    await fails(()=>rpc('start_student_word_practice_v1',[student,key,hash,{}, {},hash,[{direction:'english_to_korean',correctChoiceIndex:0}]]),'practice_source_changed');
    await fails(()=>rpc('begin_prepared_practice_v1',[student,p]),'preparation_expired');
    expect((await owner('select count(*) n from private.student_word_practice_runs')).rows[0].n).toBe(0);
  });
  it('미접수 local 응시는 기한이 지나도 정리하지 않고 기존 시작을 반환한다',async()=>{
    const device='a'.repeat(64),p=await rpc<{preparationId:string;planHash:string}>('prepare_local_quiz_v1',[student,assignment,device,await questions()]);
    const started=await rpc<{attemptId:string;startedAt:string}>('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]);
    await expirePrep(p.preparationId);await owner("update quiz_attempts set deadline_at=started_at+interval '1 millisecond' where id=$1",[started.attemptId]);
    const before=await snapshot();expect((await run(await preview('preparations'))).removed).toBe(0);expect(await snapshot()).toEqual(before);
    const replay=await rpc<{startedAt:string}>('begin_local_quiz_v1',[student,p.preparationId,device,p.planHash]);expect(replay.startedAt).toBe(started.startedAt);
  });
  it('다른 진행 응시의 재연결과 준비 불변 보호를 유지한다',async()=>{
    const p=await prepare();await begin(p);
    await owner(`insert into private.quiz_attempt_preparations(id,student_id,assignment_id,kind,request_key,fingerprint,plan,expires_at)
      values($1,$2,$3,'initial','old-alternate','fake','[]',$4::timestamptz-interval '48 hours')`,[id(909),student,assignment,cutoff]);
    expect((await preview('preparations')).candidateCount).toBe(0);
    expect(await begin(id(909))).toBe(p);
    await fails(()=>owner("update private.quiz_attempt_preparations set plan='{}' where id=$1",[p]),'question_preparation_immutable');
  });

  it('숫자 앞0과 대문자UUID로 보존해도 같은 행을 보호한다',async()=>{
    await cron(901,'succeeded','8 days');await owner("select private.set_operational_retention_hold_v1('cron','0901','canonical')");
    expect((await run(await preview('cron'))).removed).toBe(0);
    const p=await prepare();await expirePrep(p);
    await owner("select private.set_operational_retention_hold_v1('preparations',$1,'canonical')",[p.toUpperCase()]);
    expect((await run(await preview('preparations'))).removed).toBe(0);
  });
  async function endedLegacy(){
    const p=await prepare();
    const original=(await owner('select private.resolve_quiz_preparation_plan_v2(p) plan from private.quiz_attempt_preparations p where id=$1',[p])).rows[0].plan;
    await owner(`with gone as(delete from private.quiz_attempt_preparations where id=$1 returning *)
      insert into private.quiz_attempt_preparations(id,student_id,assignment_id,kind,request_key,request_hash,fingerprint,plan,created_at,expires_at,begun_id)
      select id,student_id,assignment_id,kind,request_key,request_hash,fingerprint,$2::jsonb,created_at,expires_at,begun_id from gone`,[p,JSON.stringify(original)]);
    await begin(p);
    await owner("update quiz_attempts set started_at=started_at-interval '10 minutes',current_question_started_at=current_question_started_at-interval '10 minutes',deadline_at=deadline_at-interval '10 minutes' where id=$1",[p]);
    await rpc('expire_quiz_attempt',[student,p]);
    return {p,original};
  }
  it('구형 본문은 종료·복원 확인 후24시간을 기다리고 전체 복원값을 보존한다',async()=>{
    const {p,original}=await endedLegacy();const before=await snapshot();
    const at=(await owner('select clock_timestamp()::text t')).rows[0].t as string;
    const first=await run(await preview('preparations','',250,at));expect(first.verified).toBe(1);expect(first.compacted).toBe(0);
    await owner("update private.quiz_preparation_compaction_checks set verified_at=$2::timestamptz-interval '23:59:59' where preparation_id=$1",[p,at]);
    expect((await preview('preparations','',250,at)).candidateCount).toBe(0);
    await owner("update private.quiz_preparation_compaction_checks set verified_at=$2::timestamptz-interval '24 hours' where preparation_id=$1",[p,at]);
    // A new traversal after the completed verification batch uses a new fixed cutoff.
    const later=(await owner('select clock_timestamp()::text t')).rows[0].t as string;
    expect((await run(await preview('preparations','',250,later))).compacted).toBe(1);
    const actual=(await owner('select plan,private.resolve_quiz_preparation_plan_v2(p) expanded from private.quiz_attempt_preparations p where id=$1',[p])).rows[0];
    expect(actual.expanded).toEqual(original);expect(actual.plan).toMatchObject({contentStorageVersion:2});expect(await snapshot()).toEqual(before);
  });
  it('구형 본문이 실제 공용 문항과 한 글자라도 다르면 축소하지 않는다',async()=>{
    const {p}=await endedLegacy();
    await owner(`update private.quiz_attempt_preparations set plan=jsonb_set(plan,'{0,prompt}','"Changed fake word"') where id=$1`,[p]);
    expect((await preview('preparations','',250,(await owner('select clock_timestamp()::text t')).rows[0].t as string)).candidateCount).toBe(0);
  });
  async function practiceFixture(begun=true){
    const runId=id(710),p=id(711),key=id(712),hash='a'.repeat(64);
    const body=(await owner(`select jsonb_build_object('wordKey','fake:practice','direction','english_to_korean','correctChoiceIndex',0,
      'prompt','fake1','choices',jsonb_build_array('Fake meaning1','Fake meaning2','Fake meaning3','Fake meaning4'),
      'choiceSources',(select jsonb_agg(jsonb_build_object('entryId',id,'headword',headword,'primaryMeaning',primary_meaning) order by source_row)
        from vocab_entries where dataset_id=$1)) body`,[id(4)])).rows[0].body;
    const compact=(await owner('select private.compact_practice_questions_v2($1::jsonb)->0 body',[JSON.stringify([body])])).rows[0].body as Record<string,unknown>;
    await owner(`insert into private.student_word_practice_runs(id,student_id,request_key,request_hash,source_hash,selection,settings,question_count,deadline_at,status,finished_at)
      values($1,$2,$3,$4,$4,'{}','{"timingMode":"none"}',1,'infinity','completed',clock_timestamp())`,[runId,student,key,hash]);
    await owner("insert into private.student_word_practice_questions(run_id,ordinal,body,content_version_id) values($1,1,$2::jsonb-'content_version_id',$3)",[runId,JSON.stringify(compact),compact.content_version_id]);
    const plan={requestKey:key,requestHash:hash,sourceHash:hash,selection:{},settings:{timingMode:'none'},questions:[body]};
    await owner(`insert into private.quiz_attempt_preparations(id,student_id,kind,request_key,request_hash,fingerprint,plan,expires_at,begun_id)
      values($1,$2,'practice',$3,$4,$4,$5::jsonb,$6::timestamptz-interval '24 hours',$7)`,[p,student,key,hash,JSON.stringify(plan),cutoff,begun?runId:null]);
    return {p,runId,plan,key,hash};
  }
  it('자율연습 시작 표시가 빠져도 실제 응시를 보존하고 복구한다',async()=>{
    const {p,runId}=await practiceFixture(false);expect((await preview('preparations')).candidateCount).toBe(0);
    const recovered=await rpc<{attempt:{id:string}}>('begin_prepared_practice_v1',[student,p]);expect(recovered.attempt.id).toBe(runId);
  });
  it('구형 자율연습 본문도 기존 공용판으로 복원한 뒤24시간에 축소한다',async()=>{
    const {p,runId,plan}=await practiceFixture();const at=(await owner('select clock_timestamp()::text t')).rows[0].t as string;
    const before=(await owner('select to_jsonb(r) row from private.student_word_practice_runs r where id=$1',[runId])).rows;
    expect((await run(await preview('preparations','',250,at))).verified).toBe(1);
    await owner("update private.quiz_preparation_compaction_checks set verified_at=$2::timestamptz-interval '24 hours' where preparation_id=$1",[p,at]);
    const later=(await owner('select clock_timestamp()::text t')).rows[0].t as string;
    expect((await run(await preview('preparations','',250,later))).compacted).toBe(1);
    expect((await owner('select private.resolve_quiz_preparation_plan_v2(p) plan from private.quiz_attempt_preparations p where id=$1',[p])).rows[0].plan).toEqual(plan);
    expect((await owner('select to_jsonb(r) row from private.student_word_practice_runs r where id=$1',[runId])).rows).toEqual(before);
  });
  it('배치 중 DB 오류가 나면 앞에서 지운 행과 접수 결과도 되돌린다',async()=>{
    await cron(901,'succeeded','8 days');await cron(902,'succeeded','8 days');
    await owner('select 1');
    await db.exec(`create function pg_temp.fail_retention() returns trigger language plpgsql as $$begin raise exception 'fake_batch_failure';end$$;
      create trigger fake_fail_retention before delete on cron.job_run_details for each row when(old.runid=902) execute function pg_temp.fail_retention()`);
    await fails(async()=>run(await preview('cron')),'fake_batch_failure');
    expect((await owner('select count(*) n from cron.job_run_details')).rows[0].n).toBe(2);
    expect((await owner('select count(*) n from private.operational_retention_state')).rows[0].n).toBe(0);
  });
  it('미리보기가 오래 걸려도 첫 후보를 처리하여 다음 위치로 진행한다',async()=>{
    await cron(901,'succeeded','8 days');await cron(902,'succeeded','8 days');const p=await preview('cron');
    await owner(`do $$declare src text;begin
      select pg_get_functiondef('private.preview_operational_retention_v1(text,timestamptz,text,integer)'::regprocedure) into src;
      execute replace(src,'  fingerprint:=','  perform pg_sleep(2.1); fingerprint:=');end$$`);
    const first=await run(p);expect(first.scanned).toBeGreaterThan(0);expect(first.nextCursor).not.toBe('');
    expect(first.removed).toBe(1);expect(first.hasMore).toBe(true);
  },10_000);
  it('2만개 가짜 로그에서도 미리보기와 실행은 지정한250개로 제한한다',async()=>{
    await owner(`insert into cron.job_run_details(jobid,runid,database,username,command,status,start_time,end_time)
      select 777,n,current_database(),'postgres','select 777','succeeded',$1::timestamptz-interval '9 days',$1::timestamptz-interval '8 days'
      from generate_series(1000,20999)n`,[cutoff]);
    const p=await preview('cron');expect(p.candidateCount).toBe(250);expect(p.hasMore).toBe(true);
    const result=await run(p);expect(result.scanned).toBeLessThanOrEqual(250);expect(result.removed).toBeGreaterThan(0);
    expect((await owner('select count(*) n from cron.job_run_details')).rows[0].n).toBe(20000-result.removed);
  });
});
