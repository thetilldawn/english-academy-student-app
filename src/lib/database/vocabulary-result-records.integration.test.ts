import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { vocabularyResultRecordSchema } from "@/features/results/public-contracts";

const id = (n: number) => `a4040000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), student = id(2), other = id(3), dataset = id(4), unit = id(5);
type Phase = { phase: string; target_count: number; correct_count: number; wrong_count: number; unanswered_count: number;
  score: number; passed: boolean | null; content_hash: string; started_at: string | null; ended_at: string | null; end_reason: string };
type Result = { retentionPolicy: string; detailScope: string; state: string; finalized: boolean; retryStarted: boolean; phases: Phase[]; resultVersion: string };
type Exam = { assignment: string; attempt: string; questions: string[]; student: string };

it("검토 DB의 CRLF 함수도 검수한 내용과 같을 때만 종료 기록을 연결한다", async () => {
  let database: PGlite | undefined;
  try {
    database = await createFinalSchemaDatabase({beforeMigration: async (pending, name) => {
      if (name !== "20261002040000_preserve_compact_vocabulary_results.sql") return;
      database = pending;
      const funcs = await pending.query<{definition: string}>(`select pg_get_functiondef(oid) definition from pg_proc
        where oid in ('private.grade_vocabulary_base(uuid,uuid,uuid,text,smallint)'::regprocedure,
        'private.abandon_student_attempt_v1(uuid,uuid)'::regprocedure)`);
      for (const fn of funcs.rows) await pending.exec(fn.definition.replace(/\r?\n/g, "\r\n"));
      expect((await pending.query("select md5(prosrc) hash from pg_proc where oid='private.abandon_student_attempt_v1(uuid,uuid)'::regprocedure")).rows)
        .toEqual([{hash: "1b29e62a9b7a87fca5c854b03d70d2aa"}]);
    }});
    const value = await database.query<{grade: boolean; abandon: boolean}>(`select
      (select position('finalize_vocabulary_expiry_v2' in prosrc)>0 from pg_proc where oid='private.grade_vocabulary_base(uuid,uuid,uuid,text,smallint)'::regprocedure) grade,
      (select position('freeze_vocabulary_result_v1' in prosrc)>0 from pg_proc where oid='private.abandon_student_attempt_v1(uuid,uuid)'::regprocedure) abandon`);
    expect(value.rows).toEqual([{grade:true, abandon:true}]);
  } finally { await database?.close(); }
}, 120_000);

describe.sequential("종료 시험의 작은 단계별 결과", () => {
  let db: PGlite;
  const originalTables = ["public.assignments", "public.assignment_students", "public.assignment_questions", "public.quiz_attempts", "public.quiz_questions",
    "public.student_vocab_state", "public.student_vocab_wrong_events", "public.student_point_events", "private.vocabulary_answer_receipts",
    "private.student_vocabulary_meaning_states", "private.student_vocabulary_versions", "private.vocabulary_question_content_versions"];
  let original: Record<string, unknown[]>;
  const legacy: Exam[] = [];
  async function rows<T = Record<string, unknown>>(sql: string, args: unknown[] = []) { return (await db.query<T>(sql, args)).rows; }
  async function service<T>(sql: string, args: unknown[] = []) {
    await db.exec("select set_config('request.jwt.claim.role','service_role',true); set local role service_role");
    const result = await rows<T>(sql, args); await db.exec("reset role"); return result;
  }
  async function fail(action: () => Promise<unknown>, message: string) {
    await db.exec("savepoint expected_failure");
    try { await expect(action()).rejects.toThrow(message); }
    finally { await db.exec("rollback to expected_failure; release expected_failure"); }
  }
  async function snapshot(tables = originalTables) {
    const result: Record<string, unknown[]> = {};
    for (const table of tables) result[table] = await rows(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`);
    return result;
  }
  async function exam(n: number, options: { student?: string; count?: number; assignment?: string } = {}): Promise<Exam> {
    const sid = options.student ?? student, count = options.count ?? 4;
    const assignment = options.assignment ?? id(n), attempt = id(n + 10000);
    if (!options.assignment) {
      await db.query(`insert into assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,
        timing_mode,passing_score,status,created_by,retake_allowed,range_basis,question_bank_version,retry_enabled)
        values($1,'가짜 결과 시험',$2,1,$4,$4,100,240,'none',80,'active',$3,true,'units',1,true)`, [assignment, dataset, admin, count]);
      await db.query("insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values($1,$2,$3,1,true)", [assignment, dataset, unit]);
      await db.query(`insert into assignment_questions(assignment_id,dataset_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,
        headword_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids,entry_row_sha256_snapshot)
        select $1,$2,e.id,e.source_row,'english_to_korean',e.headword,
          jsonb_build_array(e.primary_meaning,'다른뜻 A','다른뜻 B','다른뜻 C'),0,e.headword,e.primary_meaning,
          array[e.id,e.id,e.id,e.id],e.row_sha256 from vocab_entries e where dataset_id=$2 and source_row<=$3`, [assignment, dataset, count]);
      await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [assignment]);
    }
    await db.query("insert into assignment_students(assignment_id,student_id,assigned_by) values($1,$2,$3) on conflict do nothing", [assignment, sid, admin]);
    await db.query(`insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,question_count_snapshot,
      time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot,retry_enabled_snapshot,retry_passing_score_snapshot)
      values($1,$2,$3,(select coalesce(max(attempt_number),0)+1 from quiz_attempts where student_id=$2 and assignment_id=$3),clock_timestamp()-interval '1 second','infinity',clock_timestamp()-interval '1 second',$4,240,80,'initial',true,80)`, [attempt, sid, assignment, count]);
    await db.query(`insert into quiz_questions(attempt_id,assignment_question_id,vocab_entry_id,order_index,direction,correct_choice_index,content_version_id)
      select $1,id,vocab_entry_id,base_order_index,direction,correct_choice_index,content_version_id from assignment_questions where assignment_id=$2`, [attempt, assignment]);
    const qs = await rows<{ id: string }>("select id from quiz_questions where attempt_id=$1 order by order_index", [attempt]);
    return { assignment, attempt, questions: qs.map(q => q.id), student: sid };
  }
  async function answer(e: Exam, index: number, choice = 0, phase = "initial", timeout = false) {
    await db.query("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '1 second' where id=$1", [e.attempt]);
    return submit(e, index, choice, phase, timeout);
  }
  async function submit(e: Exam, index: number, choice = 0, phase = "initial", timeout = false) {
    return service("select public.answer_quiz_question_v4($1,$2,$3,$4,$5::smallint,$6) value", [e.student, e.attempt, e.questions[index], phase, choice, timeout]);
  }
  async function read(e: Exam) {
    const result = (await service<{ value: Result }>("select public.read_vocabulary_result_record_v1('student',$1,$2) value", [e.student, e.attempt]))[0].value;
    if (result !== null) vocabularyResultRecordSchema.parse(result);
    return result;
  }
  async function retry(e: Exam) { await service("select public.start_quiz_retry_v2($1,$2)", [e.student, e.attempt]); }
  async function expire(e: Exam) {
    await db.query("update quiz_attempts set deadline_at=clock_timestamp()-interval '1 second' where id=$1", [e.attempt]);
    return service("select public.expire_quiz_attempt($1,$2)", [e.student, e.attempt]);
  }

  async function seed() {
    await db.exec(`grant usage on schema auth,extensions to service_role; alter role service_role bypassrls;
      begin; select set_config('request.jwt.claim.sub','${admin}',true); select set_config('request.jwt.claim.role','authenticated',true);
      insert into auth.users(id) values('${admin}');
      insert into admin_profiles(user_id,display_name,is_active) values('${admin}','가짜 관리자',true);
      insert into students(id,display_name,status,created_by) values('${student}','가짜 학생','active','${admin}'),('${other}','다른 가짜 학생','active','${admin}');
      insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${dataset}','m04-fake','가짜 결과 자료','가짜',repeat('A',64),50,'ready','${admin}');
      insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${unit}','${dataset}','DAY 1','day 1','day',1,1,50);
      insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
        select '${dataset}',n,'fakeword'||n,'fakeword'||n,array['가짜 뜻'||n],'가짜 뜻'||n,lpad(n::text,64,'B'),'${unit}',n,'word' from generate_series(1,50)n;
      commit;`);
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if (name !== "20261002040000_preserve_compact_vocabulary_results.sql") return;
      db = database;
      await seed();
      await db.exec("begin");
      for (let n = 0; n < 4; n++) {
        const e = await exam(900 + n); legacy.push(e);
        if (n === 0) for (let i = 0; i < 4; i++) await answer(e, i);
        if (n === 1 || n === 2) {
          for (let i = 0; i < 4; i++) await answer(e, i, i < 2 ? 0 : 1);
          if (n === 1) { await retry(e); await answer(e, 2, 0, "retry"); await answer(e, 3, 1, "retry"); }
        }
      }
      await db.exec("commit");
      original = await snapshot();
    } });
  }, 120_000);
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback; reset role"); });
  afterAll(async () => { await db?.close(); });

  it("새 응시 정책만 등록하고 진행 중에는 결과를 확정하지 않는다", async () => {
    const e = await exam(10);
    expect(await read(e)).toMatchObject({ retentionPolicy: "summary_and_mistakes_v1", detailScope: "initial_mistakes", state: "initial_in_progress", finalized: false, phases: [] });
    await answer(e, 0);
    expect((await read(e)).phases).toEqual([]);
  });
  it("최초 통과는 한 단계만 보관하고 동일 답 재전송은 원래 결과를 유지한다", async () => {
    const e = await exam(11);
    for (let i = 0; i < 4; i++) await answer(e, i);
    const before = await read(e);
    expect(before).toMatchObject({ state: "completed", finalized: true, retryStarted: false,
      phases: [{ phase: "initial", target_count: 4, correct_count: 4, wrong_count: 0, unanswered_count: 0, score: 100, passed: true }] });
    await submit(e, 3);
    expect(await read(e)).toEqual(before);
    await fail(() => submit(e, 3, 1), "question_already_answered");
    expect(await read(e)).toEqual(before);
  });
  it("재시험 대기와 종료를 구별하고 최초 요약을 바꾸지 않는다", async () => {
    const e = await exam(12);
    for (let i = 0; i < 4; i++) await answer(e, i, i < 2 ? 0 : 1);
    const waiting = await read(e);
    expect(waiting).toMatchObject({ state: "retry_waiting", finalized: false, retryStarted: false,
      phases: [{ phase: "initial", correct_count: 2, wrong_count: 2, score: 50, passed: false }] });
    await retry(e);
    expect(await read(e)).toMatchObject({ state: "retry_in_progress", finalized: false });
    await answer(e, 2, 0, "retry"); await answer(e, 3, 0, "retry");
    const result = await read(e);
    expect(result).toMatchObject({ state: "completed", finalized: true, retryStarted: true,
      phases: [{ phase: "initial" }, { phase: "retry", target_count: 2, correct_count: 2, score: 100, passed: true }] });
    expect(result.phases[0]).toEqual(waiting.phases[0]);
  });
  it("재시험 후 최종 점수는 재시험 정답률이 아닌 기존 누적 점수다", async () => {
    const e = await exam(13);
    for (let i = 0; i < 4; i++) await answer(e, i, i < 2 ? 0 : 1);
    await retry(e); await answer(e, 2, 0, "retry"); await answer(e, 3, 1, "retry");
    expect(await read(e)).toMatchObject({ state: "failed", finalized: true,
      phases: [{ phase: "initial", score: 50 }, { phase: "retry", target_count: 2, correct_count: 1, wrong_count: 1, score: 75, passed: false }] });
  });
  it("미응답 만료는 선택한 오답과 따로 세고 다시 만료해도 요약이 늘지 않는다", async () => {
    const e = await exam(14); await answer(e, 0, 1); await expire(e);
    const result = await read(e);
    expect(result).toMatchObject({ state: "expired", finalized: true,
      phases: [{ phase: "initial", correct_count: 0, wrong_count: 1, unanswered_count: 3, end_reason: "expired" }] });
    await service("select public.expire_quiz_attempt($1,$2)", [e.student, e.attempt]);
    expect(await read(e)).toEqual(result);
  });
  it("직접 표·내부 함수 접근을 막고 다른 학생/비활성 관리자 조회를 거절한다", async () => {
    const e = await exam(15);
    expect((await service<{ value: null }>("select public.read_vocabulary_result_record_v1('student',$1,$2) value", [other, e.attempt]))[0].value).toBeNull();
    await fail(() => service("select * from private.vocabulary_phase_results"), "permission denied");
    await fail(() => service("select private.freeze_vocabulary_result_v1($1,'initial')", [e.attempt]), "permission denied");
    await fail(() => service("select public.read_vocabulary_result_record_v1('admin',$1,$2)", [other, e.attempt]), "forbidden");
    await fail(() => service("select public.read_vocabulary_result_record_v1(null,$1,$2)", [other, e.attempt]), "forbidden");
  });
  it("늦은 마지막 재시험 답은 바깥 채점의 최종 통과 보정 뒤 요약한다", async () => {
    const e = await exam(16);
    await db.query("update quiz_attempts set retry_passing_score_snapshot=75 where id=$1", [e.attempt]);
    for (let i = 0; i < 4; i++) await answer(e, i, i < 2 ? 0 : 1);
    await retry(e); await answer(e, 2, 0, "retry");
    await db.query("update quiz_attempts set deadline_at=clock_timestamp()-interval '1 second' where id=$1", [e.attempt]);
    await answer(e, 3, 0, "retry");
    const actual = (await rows<{ passed: boolean; final_score: string }>("select passed,final_score from quiz_attempts where id=$1", [e.attempt]))[0];
    const result = await read(e), phase = result.phases.find(value => value.phase === "retry")!;
    expect(result.state).toBe("expired"); expect(phase.end_reason).toBe("expired");
    expect(phase.passed).toBe(actual.passed); expect(phase.score).toBe(Number(actual.final_score));
    expect(phase).toMatchObject({ correct_count: 1, unanswered_count: 1, score: 75 });
    expect((await rows<{ value: string }>("select current_setting('app.defer_vocabulary_result',true) value"))[0].value).not.toBe("on");
    await submit(e, 3, 0, "retry"); expect(await read(e)).toEqual(result);
  });
  it("실제 SQL 적용 전 기존12표 전체 행을 보존하고 구형 조회는 쓰기를 하지 않는다", async () => {
    expect(await snapshot()).toEqual(original);
    expect(await rows("select * from private.vocabulary_result_policies")).toEqual([]);
    expect(await rows("select * from private.vocabulary_phase_results")).toEqual([]);
    for (const e of legacy) expect((await read(e)).retentionPolicy).toBe("legacy_answers_preserved");
    expect(await snapshot()).toEqual(original);
    expect(await rows("select * from private.vocabulary_result_policies")).toEqual([]);
  });
  it("구형 재시험 답은 있지만 당시 시각이 없으면 최종 시각으로 최초 종료를 추정하지 않는다", async () => {
    const e = legacy[1];
    await db.query("update quiz_attempts set initial_completed_at=null,retry_started_at=null where id=$1", [e.attempt]);
    const result = await read(e);
    expect(result.retryStarted).toBe(true);
    expect(result.phases[0].ended_at).toBeNull(); expect(result.phases[1].started_at).toBeNull();
    expect(result.phases[1].ended_at).not.toBeNull();
  });
  it("호출자의 임의 설정은 공개 만료의 요약 저장을 생략하지 못한다", async () => {
    const e = await exam(17);
    await db.exec("select set_config('app.defer_vocabulary_result','on',true)");
    await expire(e);
    expect(await read(e)).toMatchObject({ state: "expired", finalized: true, phases: [{ unanswered_count: 4 }] });
    await fail(() => service("select private.finalize_vocabulary_expiry_v2($1,$2,null,true,false)", [student, e.attempt]), "permission denied");
  });
  it.each(["initial", "review", "retry"])("학생 삭제 중 %s 상태를 구별하고 기존 답·사건·포인트를 추가하지 않는다", async mode => {
    const e = await exam(18);
    if (mode !== "initial") {
      for (let i = 0; i < 4; i++) await answer(e, i, i < 2 ? 0 : 1);
      if (mode === "retry") { await retry(e); await answer(e, 2, 0, "retry"); }
    } else await answer(e, 0);
    const oldInitial = await rows("select to_jsonb(r) value from private.vocabulary_phase_results r where attempt_id=$1 and phase='initial'", [e.attempt]);
    const tables = ["public.quiz_questions", "public.student_vocab_wrong_events", "public.student_point_events", "private.vocabulary_answer_receipts", "private.student_vocabulary_meaning_states", "private.student_vocabulary_versions"];
    const before = await snapshot(tables);
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [admin]);
    await db.exec("set local role authenticated");
    await rows("select public.delete_student_v2($1)", [student]); await db.exec("reset role");
    expect(await snapshot(tables)).toEqual(before);
    expect(await read(e)).toBeNull();
    const result = (await service<{ value: Result }>("select public.read_vocabulary_result_record_v1('admin',$1,$2) value", [admin, e.attempt]))[0].value;
    vocabularyResultRecordSchema.parse(result);
    expect(result).toMatchObject({ finalized: true, state: "expired", finalReason: "student_deleted" });
    expect(result.phases).toHaveLength(mode === "retry" ? 2 : 1);
    if (mode !== "initial") expect(await rows("select to_jsonb(r) value from private.vocabulary_phase_results r where attempt_id=$1 and phase='initial'", [e.attempt])).toEqual(oldInitial);
  });
  it("마지막 요약 저장 실패는 답·접수·포인트까지 함께 복구하고 같은 답 재전송은 한 번만 반영한다", async () => {
    const e = await exam(19);
    await db.exec("set constraints all immediate");
    await db.query("update assignments set points_policy_version='vocab-points-v1' where id=$1", [e.assignment]);
    for (let i = 0; i < 3; i++) await answer(e, i);
    await db.query("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '1 second' where id=$1", [e.attempt]);
    const tables = [...originalTables, "private.vocabulary_result_policies", "private.vocabulary_phase_results"];
    const before = await snapshot(tables);
    await db.exec(`create function private.m04_fail_result() returns trigger language plpgsql as $$ begin raise exception 'fake_result_failure'; end; $$;
      create trigger m04_fail_result after insert on private.vocabulary_phase_results for each row execute function private.m04_fail_result();`);
    await fail(() => submit(e, 3), "fake_result_failure");
    expect(await snapshot(tables)).toEqual(before);
    await db.exec("drop trigger m04_fail_result on private.vocabulary_phase_results; drop function private.m04_fail_result()");
    await submit(e, 3);
    const success = await snapshot(tables);
    expect((await read(e)).finalized).toBe(true);
    expect((await rows<{ n: number }>("select coalesce(sum(delta),0)::int n from student_point_events where quiz_attempt_id=$1", [e.attempt]))[0].n).toBeGreaterThan(0);
    await submit(e, 3); expect(await snapshot(tables)).toEqual(success);
    await fail(() => rows("update private.vocabulary_phase_results set correct_count=correct_count where attempt_id=$1", [e.attempt]), "result_already_finalized");
  });
  it("문항 시간초과의 임시 선택 번호를 실제로 선택한 오답으로 세지 않는다", async () => {
    const e = await exam(20);
    await db.query("update assignments set timing_mode='per_question',question_time_limit_seconds=5 where id=$1", [e.assignment]);
    await db.query("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '10 seconds' where id=$1", [e.attempt]);
    await submit(e, 0, 0, "initial", true);
    for (let i = 1; i < 4; i++) await answer(e, i);
    expect((await read(e)).phases[0]).toMatchObject({ correct_count: 3, wrong_count: 0, unanswered_count: 1 });
  });
  it("같은 배정 재응시와 별도 복습 배정은 원래 응시·공용문항 관계를 유지한다", async () => {
    const first = await exam(21);
    for (let i = 0; i < 4; i++) await answer(first, i);
    const original = await read(first);
    const again = await exam(22, { assignment: first.assignment });
    const separate = await exam(23);
    for (const e of [again, separate]) for (let i = 0; i < 4; i++) await answer(e, i);
    expect(await read(first)).toEqual(original);
    const attempts = await rows<{ assignment_id: string; attempt_number: number }>("select assignment_id,attempt_number from quiz_attempts where id=any($1::uuid[]) order by id", [[first.attempt, again.attempt, separate.attempt]]);
    expect(attempts).toEqual([{ assignment_id: first.assignment, attempt_number: 1 }, { assignment_id: first.assignment, attempt_number: 2 }, { assignment_id: separate.assignment, attempt_number: 1 }]);
    expect((await rows<{ n: number }>("select count(*)::int n from quiz_questions q join assignment_questions b on b.id=q.assignment_question_id where q.attempt_id=any($1::uuid[]) and q.content_version_id<>b.content_version_id", [[first.attempt, again.attempt, separate.attempt]]))[0].n).toBe(0);
  });
  it("원단어 수정과 원자료 비활성 뒤에도 고정된 문항과 결과를 유지한다", async () => {
    const e = await exam(24);
    for (let i = 0; i < 4; i++) await answer(e, i);
    const record = await read(e);
    const content = () => rows("select prompt,choices,correct_choice_index from private.quiz_question_contents_v1 where attempt_id=$1 order by order_index", [e.attempt]);
    const before = await content();
    await db.query("update vocab_entries set headword='changed',primary_meaning='바뀐 뜻' where dataset_id=$1", [dataset]);
    await db.query("update vocab_datasets set is_active=false where id=$1", [dataset]);
    expect(await content()).toEqual(before); expect(await read(e)).toEqual(record);
  });
  it("가짜100명50문항의 다섯 종료 유형을160단계로 보관하고 비용을 분리한다", async () => {
    const attempts: string[] = [], students = Array.from({ length: 100 }, (_, n) => id(3000 + n));
    await db.query("insert into students(id,display_name,status,created_by) select x,'가짜 비용 학생','active',$2 from unnest($1::uuid[]) x", [students, admin]);
    let assignment: string | undefined;
    for (let n = 0; n < 100; n++) {
      const e = await exam(1000 + n, { student: students[n], count: 50, assignment });
      assignment = e.assignment; attempts.push(e.attempt);
    }
    await db.query("update quiz_attempts set started_at=now()-interval '1 minute' where id=any($1::uuid[])", [attempts]);
    await db.exec("set constraints all immediate");
    // Real public grading/expiry routines, sequential in one synthetic transaction.
    await db.query(`do $body$ declare a record; q record; group_no integer; idx integer:=0; begin
      perform set_config('request.jwt.claim.role','service_role',true);
      for a in select id,student_id from quiz_attempts where assignment_id='${assignment}' order by student_id loop
        group_no:=idx/20; idx:=idx+1;
        for q in select id,order_index from quiz_questions where attempt_id=a.id order by order_index loop
          if group_no=3 and q.order_index>10 then exit; end if;
          update quiz_attempts set current_question_started_at=clock_timestamp()-interval '1 second' where id=a.id;
          perform public.answer_quiz_question_v4(a.student_id,a.id,q.id,'initial',(case when group_no in (0,3) or q.order_index<=30 then 0 else 1 end)::smallint,false);
        end loop;
        if group_no in (1,2,4) then
          perform public.start_quiz_retry_v2(a.student_id,a.id);
          for q in select id,order_index from quiz_questions where attempt_id=a.id and initial_is_correct is false order by order_index loop
            if group_no=4 and q.order_index>35 then exit; end if;
            update quiz_attempts set current_question_started_at=clock_timestamp()-interval '1 second' where id=a.id;
            perform public.answer_quiz_question_v4(a.student_id,a.id,q.id,'retry',(case when group_no=2 then 1 else 0 end)::smallint,false);
          end loop;
        end if;
        if group_no in (3,4) then
          update quiz_attempts set deadline_at=now()-interval '1 second' where id=a.id;
          perform public.expire_quiz_attempt(a.student_id,a.id);
        end if;
      end loop;
    end $body$`);
    const n = (await rows<{ policies: number; phases: number; inline_bodies: number; receipts: number }>(`select
      (select count(*)::int from private.vocabulary_result_policies where attempt_id=any($1::uuid[])) policies,
      (select count(*)::int from private.vocabulary_phase_results where attempt_id=any($1::uuid[])) phases,
      (select count(*)::int from quiz_questions where attempt_id=any($1::uuid[]) and (prompt is not null or choices is not null or content_version_id is null)) inline_bodies,
      (select count(*)::int from private.vocabulary_answer_receipts where attempt_id=any($1::uuid[])) receipts`, [attempts]))[0];
    expect(n).toEqual({ policies: 100, phases: 160, inline_bodies: 0, receipts: 6200 });
    const groups = await rows<{ status: string; n: number }>("select status::text||':'||passed::text status,count(*)::int n from quiz_attempts where id=any($1::uuid[]) group by status,passed order by status,passed", [attempts]);
    expect(groups).toEqual([{ status: "completed:false", n: 20 }, { status: "completed:true", n: 40 }, { status: "expired:false", n: 40 }]);
    const categories: [string, string, string, unknown][] = [
      ["policies", "private.vocabulary_result_policies", "attempt_id=any($1::uuid[])", attempts],
      ["phases", "private.vocabulary_phase_results", "attempt_id=any($1::uuid[])", attempts],
      ["questionKeysAndOldAnswerFields", "public.quiz_questions", "attempt_id=any($1::uuid[])", attempts],
      ["receipts", "private.vocabulary_answer_receipts", "attempt_id=any($1::uuid[])", attempts],
      ["meaningStates", "private.student_vocabulary_meaning_states", "student_id=any($1::uuid[])", students],
      ["sharedContent", "private.vocabulary_question_content_versions", "id in(select content_version_id from quiz_questions where attempt_id=any($1::uuid[]))", attempts],
    ];
    const size: Record<string, unknown> = {};
    for (const [key, table, filter, args] of categories) {
      size[key] = (await rows(`select count(*)::int rows,coalesce(sum(pg_column_size(t)),0)::bigint row_bytes,
        pg_table_size('${table}') table_bytes_all_fixtures,pg_indexes_size('${table}') index_bytes_all_fixtures from ${table} t where ${filter}`, [args]))[0];
    }
    expect((size.sharedContent as { rows: number }).rows).toBe(50);
    process.stdout.write(JSON.stringify({ scenario: "M04 100 synthetic students x50 questions, sequential storage example; not concurrent capacity", counts: n, size }) + "\n");
  }, 120_000);
});
