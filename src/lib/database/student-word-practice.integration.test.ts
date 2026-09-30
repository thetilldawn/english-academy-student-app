import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildPracticePlan, practiceSourceSchema, type PracticeSource } from "@/features/quiz-player/domain/practice-plan";
import type { PracticeSettings } from "@/features/quiz-player/contracts/practice";
import type { QuizAnswerResponse, QuizAttemptResponse, QuizFeedbackResumeResponse } from "@/features/quiz-player/model";

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const student=id(2), other=id(3), selection={mode:"filtered",filters:{}}, hash="a".repeat(64);
const voice={displayKo:"발음검사용",variantId:null,audioUrl:"https://example.invalid/fake.mp3",available:true};
const settings=(timingMode:PracticeSettings["timingMode"]="none", questionCount=4):PracticeSettings=>({questionCount,englishToKoreanRatio:50,timingMode,timeLimitSeconds:timingMode==="total"?240:null,questionTimeLimitSeconds:timingMode==="per_question"?5:null});
describe.sequential("별도 자율연습과 정규 자료 보존",()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=await createFinalSchemaDatabase();
    const previous=readFileSync("supabase/migrations/20260929165150_expand_student_word_notebook.sql","utf8");
    await db.exec(previous.slice(previous.indexOf("create function private.wrong_word_notebook_page_v2("),previous.indexOf("-- Server-only adapter."))
      .replace("private.wrong_word_notebook_page_v2(","private.expected_notebook_before_practice("));
    await db.exec(`begin;
      select set_config('request.jwt.claim.sub','${id(1)}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claims','{"role":"authenticated"}',true);
      insert into auth.users(id) values('${id(1)}');
      insert into admin_profiles(user_id,display_name,is_active) values('${id(1)}','가짜관리자',true);
      insert into students(id,display_name,status,created_by) values('${student}','가짜연습학생','active','${id(1)}'),('${other}','다른가짜학생','active','${id(1)}');
      insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${id(4)}','practice-integration-fake','가짜 연습 책','가짜',repeat('A',64),4,'ready','${id(1)}');
      insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${id(100)}','${id(4)}','DAY 1','day 1','day',1,1,4);
      insert into assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,timing_mode,question_time_limit_seconds,passing_score,status,created_by,retake_allowed)
        values('${id(10)}','가짜 원천 시험','${id(4)}',1,4,4,240,'none',null,80,'active','${id(1)}',true);
      insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values('${id(10)}','${id(4)}','${id(100)}',1,true);
      insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) values('${id(10)}','${student}','${id(1)}',clock_timestamp()-interval '1 day');
      insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
        values('${id(60)}','${student}','${id(10)}',1,clock_timestamp()-interval '1 second',clock_timestamp()+interval '233 seconds',clock_timestamp()-interval '1 second',4,240,80,'initial');
      insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
        select '${id(4)}',n,(array['collect','travel','patient','enormous'])[n],(array['collect','travel','patient','enormous'])[n],
          array[(array['모으다','여행하다','참을성 있는','거대한'])[n]],(array['모으다','여행하다','참을성 있는','거대한'])[n],repeat('B',63)||n::text,'${id(100)}',n,'word' from generate_series(1,4)n;
      insert into quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index)
        select ('91000000-0000-4000-8000-'||lpad((200+e.source_row)::text,12,'0'))::uuid,'${id(60)}',e.id,e.source_row,'english_to_korean',e.headword,
          (select jsonb_agg(v.primary_meaning order by v.source_row) from vocab_entries v where v.dataset_id=e.dataset_id),(e.source_row-1)::smallint from vocab_entries e where e.dataset_id='${id(4)}';
      insert into student_vocab_wrong_events(student_id,dataset_id,vocab_entry_id,quiz_attempt_id,quiz_question_id,wrong_stage,wrong_at)
        select '${student}','${id(4)}',vocab_entry_id,attempt_id,id,'initial',clock_timestamp() from quiz_questions where attempt_id='${id(60)}';
      insert into vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
        select e.id,e.dataset_id,m.mode,'eligible',repeat('B',64),'fixture',clock_timestamp() from vocab_entries e cross join(values('book_meaning_en_to_ko'),('book_meaning_ko_to_en'))m(mode) where e.dataset_id='${id(4)}';
      commit;`);
  },120000);
  beforeEach(async()=>{await db.exec("begin; select set_config('request.jwt.claim.role','service_role',true)");});
  afterEach(async()=>{await db.exec("rollback");});
  afterAll(async()=>{await db?.close();});
  async function rpc<T>(name:string,args:unknown[]=[]){
    await db.exec("set local role service_role");
    return (await db.query<{value:T}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) value`,args)).rows[0].value;
  }
  async function owner(query:string,args:unknown[]=[]){await db.exec("reset role");return db.query<Record<string,unknown>>(query,args);}
  async function fails(action:()=>Promise<unknown>,message:string){
    await db.exec("savepoint expected_failure");
    try{await expect(action()).rejects.toThrow(message);}finally{await db.exec("rollback to expected_failure;release expected_failure");}
  }
  async function source(){return practiceSourceSchema.parse(await rpc("prepare_student_word_practice_v1",[student,selection]));}
  function questions(raw:PracticeSource,config:PracticeSettings){
    const plan=buildPracticePlan(raw,config,"same-seed"),byId=new Map(plan.candidates.map(e=>[e.id,e]));
    if(plan.error)throw new Error(plan.error);
    return plan.questions.map(q=>({...q,wordKey:byId.get(q.vocabEntryId)!.key,pronunciation:voice,choicePronunciations:[voice,voice,voice,voice],
      choiceSources:q.choiceVocabEntryIds.map(id=>{const e=byId.get(id)!;return{entryId:e.entryId,headword:e.headword,primaryMeaning:e.primaryMeaning};})}));
  }
  async function start(config=settings(),key=id(400),raw?:PracticeSource){const input=raw??await source();return rpc<QuizAttemptResponse>("start_student_word_practice_v1",[student,key,hash,selection,config,input.sourceHash,questions(input,config)]);}
  async function answer(run:QuizAttemptResponse,at:number,choice:number|null=0){return rpc<QuizAnswerResponse>("answer_student_word_practice_v1",[student,run.attempt.id,run.attempt.questions[at].id,choice]);}
  async function resume(run:QuizAttemptResponse,at:number,ms=0){return rpc<QuizFeedbackResumeResponse>("resume_student_word_practice_v1",[student,run.attempt.id,run.attempt.questions[at].id,ms]);}
  async function snapshot(){
    await db.exec("reset role;set constraints all immediate");
    const names=["students","vocab_entries","assignments","assignment_students","assignment_questions","quiz_attempts","quiz_questions","student_vocab_wrong_events","student_vocab_state","student_point_events","student_vocab_review_queue"];
    const result:unknown[]=[];
    for(const name of names){const exists=(await db.query<{value:boolean}>("select to_regclass($1) is not null value",["public."+name])).rows[0].value;
      if(exists)result.push((await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from public.${name} t`)).rows);}
    return result;
  }
  it("연습 완료·읽기·결과가 정규 기록과 포인트를 변경하지 않는다",async()=>{
    const before=await snapshot(),run=await start();
    for(let n=0;n<4;n++){if(n)await resume(run,n);await answer(run,n);}
    const result=await rpc<QuizAttemptResponse>("get_student_word_practice_v1",[student,run.attempt.id]);
    expect(result.attempt.status).toBe("completed");expect(result.attempt.questions.every(q=>q.revealedCorrectChoiceIndex!==null)).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
  it("미응답 정답과 방향별 정답 추측 음원/원천을 응답에서 제거한다",async()=>{
    const run=await start();
    for(const q of run.attempt.questions){expect(q.revealedCorrectChoiceIndex).toBeNull();expect(q).not.toHaveProperty("wordKey");expect(q).not.toHaveProperty("choiceSources");
      if(q.direction==="english_to_korean")expect(q.choicePronunciations.every(p=>p.audioUrl===null&&p.displayKo===null)).toBe(true);
      else expect(q.pronunciation.audioUrl).toBeNull();}
  });
  it("성공한 시작은 원천이 바뀌어도 같은 키로 재전송하면 같은 회차다",async()=>{
    const raw=await source(),run=await start(settings(),id(400),raw);
    await owner("delete from public.vocab_entry_quiz_eligibility where dataset_id=$1",[id(4)]);
    const again=await start(settings(),id(400),raw);expect(again.attempt.id).toBe(run.attempt.id);
    await fails(()=>rpc("get_student_word_practice_v1",[student,null,id(400),"b".repeat(64)]),"practice_request_conflict");
    const count=await owner("select count(*)::integer n from private.student_word_practice_runs");expect(count.rows[0].n).toBe(1);
  });
  it("새 시작은 원천 변경과 출제 불가 후보 우회를 거절한다",async()=>{
    const raw=await source(),question=questions(raw,settings());
    await owner("delete from public.vocab_entry_quiz_eligibility where dataset_id=$1",[id(4)]);
    await fails(()=>start(settings(),id(401),raw),"practice_source_changed");
    const changed=await source();expect(changed.candidates).toHaveLength(0);
    await fails(()=>rpc("start_student_word_practice_v1",[student,id(402),hash,selection,settings(),changed.sourceHash,question]),"practice_target_not_eligible");
  });
  it("누적10001개에서도 선택1개와500개는 한번의 범위 조회로 읽고 누락키는 거절한다",async()=>{
    process.stdout.write('capacity test started\n');
    const one=(await source()).words[0].key;
    await db.exec("reset role");
    let stageAt=performance.now();
    const stage=(label:string)=>{process.stdout.write('가짜10001개 검사 '+label+' '+Math.round(performance.now()-stageAt)+'ms\n');stageAt=performance.now();};
    await db.exec(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select '${id(4)}',n,'fixtureword'||n,'fixtureword'||n,array['가짜 뜻'||n],'가짜 뜻'||n,upper(md5(n::text)||md5(n::text)),'${id(100)}',n,'word' from generate_series(5,10001)n;`);
    stage('단어 시드');
    await db.exec(`insert into public.quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index)
      select ('91000000-0000-4000-8000-'||lpad((200+e.source_row)::text,12,'0'))::uuid,'${id(60)}',e.id,e.source_row,'english_to_korean',e.headword,
        jsonb_build_array(e.primary_meaning,'가짜보기가','가짜보기나','가짜보기다'),0 from public.vocab_entries e where e.dataset_id='${id(4)}' and e.source_row>=5;`);
    stage('문항 시드');
    await db.exec(`insert into public.student_vocab_wrong_events(student_id,dataset_id,vocab_entry_id,quiz_attempt_id,quiz_question_id,wrong_stage,wrong_at)
      select '${student}','${id(4)}',vocab_entry_id,attempt_id,id,'initial',clock_timestamp() from public.quiz_questions where attempt_id='${id(60)}' and order_index>=5;`);
    stage('오답 시드');
    await db.exec("analyze public.vocab_entries;analyze public.quiz_questions;analyze public.student_vocab_wrong_events;");
    const page=await rpc<{totalCount:number;items:{key:string}[]}>("get_student_wrong_word_notebook_page_v2",[student,null,"all","",null,null,null,null,null,"count",null,null,501]);
    expect(page.totalCount).toBe(10001);
    stage('목록501');
    for(const keys of [[one],page.items.slice(0,500).map(w=>w.key)]){
      const selected=practiceSourceSchema.parse(await rpc("prepare_student_word_practice_v1",[student,{mode:"selected",keys}]));
      expect(selected.words).toHaveLength(keys.length);expect(new Set(selected.words.map(w=>w.key))).toEqual(new Set(keys));
      stage('선택'+keys.length);
    }
    await fails(()=>rpc("prepare_student_word_practice_v1",[student,{mode:"selected",keys:[one,"missing-or-another-student"]}]),"practice_source_changed");
    await fails(()=>source(),"practice_range_too_large");
  },120000);
  it("기존 목록 전체 JSON과 누적/책/검색/횟수/상세/다음페이지 계약을 보존한다",async()=>{
    const key=(await source()).words[0].key;
    const cases:unknown[][]=[[],[student,id(4)],[student,null,"all","collect"],
      [student,null,"once",""],[student,null,"all","",null,null,null,1,1],[student,null,"all","",null,null,null,null,null,"recent"],
      [student,null,"all","",null,null,null,null,null,"count",null,key]];
    const first=await rpc<{items:{key:string;lastWrongAt:string;wrongCount:number}[];eventUpperId:string}>("get_student_wrong_word_notebook_page_v2",[student,null,"all","",null,null,null,null,null,"count",null,null,1]);
    const last=first.items[0];cases.push([student,null,"all","",first.eventUpperId,last.lastWrongAt,last.key,null,null,"count",last.wrongCount]);
    for(const values of cases){const args=values.length?values:[student];
      const result=await owner(`select private.expected_notebook_before_practice(${args.map((_,i)=>`$${i+1}`).join(",")}) old,
        private.wrong_word_notebook_page_v2(${args.map((_,i)=>`$${i+1}`).join(",")}) current`,args);
      expect(result.rows[0].current).toEqual(result.rows[0].old);
    }
  });
  it("같은 답은 한 번만 저장하고 다른 답·이전 문항 재전송은 거절해 현재 상태로 회복한다",async()=>{
    const run=await start();const first=await answer(run,0);
    expect(await answer(run,0)).toEqual(first);await fails(()=>answer(run,0,1),"practice_answer_conflict");
    await resume(run,1);await answer(run,1);
    await fails(()=>answer(run,0),"practice_answer_outdated");
    expect((await rpc<QuizAttemptResponse>("get_student_word_practice_v1",[student,run.attempt.id])).attempt.currentQuestionId).toBe(run.attempt.questions[2].id);
  });
  it.each(["total","per_question","none"] as const)("%s 시간은 전환 확인에 맞춰 계산하며 반복 확인은 마감을 늘리지 않는다",async mode=>{
    const run=await start(settings(mode)),before=run.attempt.deadlineAt;
    const response=await answer(run,0);expect(response.feedbackProtocol).toBe("variable");
    const ack=await resume(run,1),again=await resume(run,1,750);expect(again.questionDeadlineAt).toBe(ack.questionDeadlineAt);expect(again.questionStartsAt).toBe(ack.questionStartsAt);
    const current=await rpc<QuizAttemptResponse>("get_student_word_practice_v1",[student,run.attempt.id]);
    if(mode==="total")expect(Math.abs(Date.parse(current.attempt.deadlineAt)-Date.parse(before))).toBeLessThan(1000);
    if(mode==="per_question"){expect(current.attempt.deadlineAt).toBe(before);expect(ack.timerRemainingMilliseconds).toBeLessThanOrEqual(5000);expect(ack.timerRemainingMilliseconds).toBeGreaterThan(4500);}
    if(mode==="none"){expect(current.attempt.deadlineAt).toBe("infinity");expect(ack.timerRemainingMilliseconds).toBe(0);}
  });
  it("750ms 전환 이전 답·751ms·이른 timeout·이른 만료를 거절한다",async()=>{
    const run=await start(settings("per_question"));
    await fails(()=>answer(run,0,null),"practice_timeout_too_early");await fails(()=>rpc("expire_student_word_practice_v1",[student,run.attempt.id]),"practice_expire_too_early");
    await answer(run,0);await fails(()=>resume(run,1,751),"invalid_practice_transition");await resume(run,1,750);
    await fails(()=>answer(run,1),"practice_question_not_ready");
  });
  it("문제당 시간 종료와 전체 만료는 별도로 처리하고 만료를 되살리지 않는다",async()=>{
    const run=await start(settings("per_question"));
    await owner("update private.student_word_practice_runs set current_starts_at=clock_timestamp()-interval '6 seconds' where id=$1",[run.attempt.id]);
    const result=await answer(run,0,null);expect(result.timedOut).toBe(true);expect(result.completed).toBe(false);
    await owner("update private.student_word_practice_runs set deadline_at=clock_timestamp()-interval '1 second' where id=$1",[run.attempt.id]);
    expect((await rpc<QuizAttemptResponse>("get_student_word_practice_v1",[student,run.attempt.id])).attempt.status).toBe("expired");
    const expired=await rpc<QuizAttemptResponse>("expire_student_word_practice_v1",[student,run.attempt.id]);expect(expired.attempt.status).toBe("expired");
    expect((await rpc<QuizAttemptResponse>("expire_student_word_practice_v1",[student,run.attempt.id])).attempt.status).toBe("expired");
    await fails(()=>resume(run,1),"practice_question_not_ready");
  });
  it("타인/차단 학생·직접표 접근과 비서비스 역할을 막는다",async()=>{
    const run=await start();expect(await rpc("get_student_word_practice_v1",[other,run.attempt.id])).toBeNull();
    await fails(()=>rpc("answer_student_word_practice_v1",[other,run.attempt.id,run.attempt.questions[0].id,0]),"practice_not_found");
    for(const role of ["anon","authenticated"]){await fails(async()=>{await db.exec(`reset role;set local role ${role}`);return db.query("select get_student_word_practice_v1($1)",[student]);},"permission denied");}
    await fails(async()=>{await db.exec("set local role service_role");return db.query("select * from private.student_word_practice_runs");},"permission denied");
    await owner("update students set status='blocked' where id=$1",[student]);await fails(()=>rpc("get_student_word_practice_v1",[student,run.attempt.id]),"practice_student_unavailable");
  });
  it("연습 내역은 안정된 최신순으로11개를 읽고 다음10개를 건너뛰지 않는다",async()=>{
    const raw=await source();for(let n=0;n<12;n++)await start(settings("none",1),id(500+n),raw);
    const first=await rpc<{id:string;startedAt:string}[]>("get_student_word_practice_v1",[student]);expect(first).toHaveLength(11);
    const last=first[9];const next=await rpc<{id:string}[]>("get_student_word_practice_v1",[student,null,null,null,last.startedAt,last.id]);expect(next).toHaveLength(2);
    expect(new Set([...first.slice(0,10),...next].map(x=>x.id)).size).toBe(12);
  });
});
