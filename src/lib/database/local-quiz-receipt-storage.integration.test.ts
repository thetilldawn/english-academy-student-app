import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { localPhasePlanSchema, localReceiptSchema, type LocalBatch, type LocalPhasePlan } from "@/features/quiz-player/contracts/local-quiz";
import { receiptConfirmsBatch } from "@/features/quiz-player/domain/local-quiz";

const migration = "20261003233000_compact_local_quiz_receipt_responses.sql";
const id = (n: number) => `a9080000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), student = id(2), dataset = id(4), unit = id(5), device = "d".repeat(64);
type Json = Record<string, unknown>;

describe.sequential("회차 접수의 작은 저장과 원응답 복원", () => {
  let db: PGlite;
  let legacy: { batch: LocalBatch; response: Json; stored: Json; attributes: Json };
  async function owner<T = Json>(sql: string, values: unknown[] = []) {
    await db.exec("reset role");
    return (await db.query<T>(sql, values)).rows;
  }
  async function rpc(name: string, values: unknown[]) {
    await db.exec("set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
    return (await db.query<{ value: unknown }>(`select public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) value`, values)).rows[0].value;
  }
  async function ownerExec(sql: string) { await db.exec("reset role"); await db.exec(sql); }
  async function attributes() {
    return (await owner(`select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) value
      from pg_proc where oid='public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb)'::regprocedure`))[0].value as Json;
  }
  async function start(count = 4, timing = "none") {
    const assignment = randomUUID();
    await owner(`with created as (insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,
      time_limit_seconds,timing_mode,question_time_limit_seconds,passing_score,status,created_by,retake_allowed,retry_enabled,retry_passing_score)
      values($1,'가짜 접수 보존 시험',$2,1,$3,$3,100,30,$4,case when $4='per_question' then 5 else null end,80,'active',$5,true,true,80) returning id),
      linked as (insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
        select id,$2,$6,1,true from created returning assignment_id)
      insert into public.assignment_students(assignment_id,student_id,assigned_by) select assignment_id,$7,$5 from linked`,
    [assignment, dataset, count, timing, admin, unit, student]);
    const questions = (await owner(`select jsonb_agg(jsonb_build_object('vocab_entry_id',e.id,'order_index',e.source_row,'direction','english_to_korean',
      'prompt',e.headword,'choices',jsonb_build_array(e.primary_meaning,'다른 가짜 뜻 A','다른 가짜 뜻 B','다른 가짜 뜻 C'),
      'correct_choice_index',0) order by e.source_row) value from public.vocab_entries e where dataset_id=$1 and source_row<=$2`, [dataset, count]))[0].value;
    const prepared = await rpc("prepare_local_quiz_v1", [student, assignment, device, questions]) as { preparationId: string; planHash: string };
    return localPhasePlanSchema.parse(await rpc("begin_local_quiz_v1", [student, prepared.preparationId, device, prepared.planHash]));
  }
  function makeBatch(plan: LocalPhasePlan, wrong = 0): LocalBatch {
    const answers = plan.items.map((q, i) => ({ id: q.id, order: i + 1, kind: "answer" as const,
      choice: i < wrong ? (q.correctChoiceIndex + 1) % 4 : q.correctChoiceIndex, openedMs: i * 100, elapsedMs: i * 100 }));
    return { submissionId: randomUUID(), attemptId: plan.attemptId, phase: plan.phase, planHash: plan.planHash, answers,
      completion: { elapsedMs: answers.at(-1)!.elapsedMs, reason: "answered" } };
  }
  async function elapsed(plan: LocalPhasePlan, milliseconds: number) {
    const passed = Number((await owner("select extract(epoch from(clock_timestamp()-$1::timestamptz))*1000 elapsed", [plan.startedAt]))[0].elapsed);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds - passed + 30)));
  }
  async function submit(batch: LocalBatch) {
    return await rpc("submit_local_quiz_phase_v1", [student, batch.attemptId, batch.phase, device, batch.planHash, batch.submissionId, batch.answers, batch.completion]) as Json;
  }
  async function stored(submission: string) {
    return (await owner("select to_jsonb(r) value from private.local_quiz_phase_receipts r where submission_id=$1", [submission]))[0].value as Json;
  }
  async function snapshot() {
    await owner("set constraints all immediate");
    const tables = ["public.quiz_attempts", "public.quiz_questions", "public.student_vocab_wrong_events", "public.student_vocab_state",
      "public.student_point_events", "public.student_point_totals", "private.vocabulary_answer_receipts", "private.student_vocabulary_meaning_states",
      "private.student_vocabulary_versions", "private.vocabulary_question_meaning_versions", "private.vocabulary_legacy_state_baselines",
      "private.vocabulary_result_policies", "private.vocabulary_phase_results", "private.local_quiz_phase_receipts", "private.local_quiz_phase_plans"];
    const result: Record<string, unknown> = {};
    for (const table of tables) result[table] = (await owner(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from ${table} t`))[0].value;
    return result;
  }
  async function fails(action: () => Promise<unknown>, message: string) {
    await db.exec("savepoint expected_failure");
    try { await expect(action()).rejects.toThrow(message); }
    finally { await db.exec("rollback to expected_failure;release expected_failure"); }
  }
  async function confirm(batch: LocalBatch, response: Json) {
    const parsed = localReceiptSchema.parse(response);
    expect(parsed).toEqual(response);
    expect(await receiptConfirmsBatch(batch, parsed)).toBe(true);
    expect(await submit(batch)).toEqual(response);
    return parsed;
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if (name !== migration) return;
      db = database;
      await db.exec("grant usage on schema auth,extensions to service_role;alter role service_role bypassrls;set time zone 'UTC'");
      await ownerExec(`begin;insert into auth.users(id)values('${admin}');
        insert into public.admin_profiles(user_id,display_name)values('${admin}','가짜 접수 관리자');
        insert into public.students(id,display_name,status,created_by)values('${student}','가짜 접수 학생','active','${admin}');
        insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
          values('${dataset}','receipt-storage-fake','가짜 접수 자료','fake',repeat('A',64),500,'ready','${admin}');
        insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
          values('${unit}','${dataset}','DAY 1','day1','day',1,1,500);
        insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
          select '${dataset}',n,'receiptword'||n,'receiptword'||n,array['가짜 뜻 '||n],'가짜 뜻 '||n,
            upper(encode(extensions.digest('receipt:'||n,'sha256'),'hex')),'${unit}',n,'word' from generate_series(1,500)n;commit;`);
      await ownerExec("begin");
      const plan = await start(); const batch = makeBatch(plan); await elapsed(plan, batch.completion.elapsedMs);
      const response = await submit(batch);
      await ownerExec("commit");
      legacy = { batch, response, stored: await stored(batch.submissionId), attributes: await attributes() };
    } });
  }, 120_000);
  beforeEach(async () => { await db.exec("reset role;begin"); });
  afterEach(async () => { await db.exec("rollback;reset role"); });
  afterAll(async () => { await db?.close(); });

  it("적용 전 원형 접수와 공개 함수의 OID·권한을 보존한다", async () => {
    expect(await stored(legacy.batch.submissionId)).toEqual(legacy.stored);
    expect(await attributes()).toEqual(legacy.attributes);
    expect((legacy.stored.result as Json).storageVersion).toBeUndefined();
    await confirm(legacy.batch, legacy.response);
  });

  it("재시험과 다른 시험 뒤에도 최초 응답을 당시 값 그대로 복원한다", async () => {
    const plan = await start(); const batch = makeBatch(plan, 2); await elapsed(plan, batch.completion.elapsedMs);
    const original = await submit(batch); await confirm(batch, original);
    const firstRow = await stored(batch.submissionId);
    expect((firstRow.result as Json).storageVersion).toBe("local-quiz-receipt-ref-v1");
    const retry = localPhasePlanSchema.parse(await rpc("begin_local_quiz_retry_v1", [student, plan.attemptId, device]));
    const retryBatch = makeBatch(retry); await elapsed(retry, retryBatch.completion.elapsedMs);
    await confirm(retryBatch, await submit(retryBatch));
    const next = await start(); const nextBatch = makeBatch(next); await elapsed(next, nextBatch.completion.elapsedMs);
    await confirm(nextBatch, await submit(nextBatch));
    const before = await snapshot();
    await confirm(batch, original);
    expect(await snapshot()).toEqual(before);
    expect(await stored(batch.submissionId)).toEqual(firstRow);
    expect((original.result as Json).state).toBe("retry_waiting");
  });

  it.each([1, 4, 50, 500])("%i문항에서 실제 작은 표현만 저장하고 개별 접수는 모두 남긴다", async count => {
    const plan = await start(count); const batch = makeBatch(plan); await elapsed(plan, batch.completion.elapsedMs);
    const original = await submit(batch); await confirm(batch, original);
    const sizes = (await owner(`select pg_column_size(r.result)::int stored_bytes,pg_column_size($2::jsonb)::int original_bytes,
      (select count(*)::int from private.vocabulary_answer_receipts where attempt_id=r.attempt_id and phase=r.phase) answers,
      r.result ? 'storageVersion' compacted from private.local_quiz_phase_receipts r where submission_id=$1`, [batch.submissionId, original]))[0];
    expect(sizes.answers).toBe(count);
    expect(Number(sizes.stored_bytes)).toBeLessThanOrEqual(Number(sizes.original_bytes));
    expect(sizes.compacted).toBe(count >= 4);
    if (count === 1) expect((await stored(batch.submissionId)).result).toEqual(original);
    // Compare both formats after storage with the same columns and TOAST settings.
    await owner("create temporary table receipt_size_probe (like private.local_quiz_phase_receipts including storage) on commit drop");
    await owner(`insert into receipt_size_probe select submission_id,attempt_id,phase,payload_hash,private.resolve_local_quiz_receipt_v1(r),received_at
      from private.local_quiz_phase_receipts r where submission_id=$1
      union all select * from private.local_quiz_phase_receipts where submission_id=$1`, [batch.submissionId]);
    const storedPair = await owner(`select result ? 'storageVersion' compacted,pg_column_size(result)::int result_bytes,
      pg_column_size(r)::int row_bytes from receipt_size_probe r order by compacted`);
    console.log(JSON.stringify({ receiptCount: count, ...sizes, storedPair }));
  }, 90_000);

  it("훼손된 저장판·헤더·개수·해시·응시 연결을 접수 성공으로 돌려주지 않는다", async () => {
    const plan = await start(); const batch = makeBatch(plan); await elapsed(plan, batch.completion.elapsedMs);
    await submit(batch); const row = await stored(batch.submissionId); const value = row.result as Json;
    const response = value.response as Json;
    for (const result of [{ ...value, storageVersion: "unknown" }, { ...value, acceptedCount: 0 }, { ...value, acceptedCount: 3 },
      { ...value, responseSha256: "0".repeat(64) }, { ...value, response: { ...response, accepted: [] } },
      { ...value, response: { ...response, phase: "retry" } }, { ...value, response: { ...response, planHash: "0".repeat(64) } },
      { ...value, response: { ...response, submissionId: randomUUID() } }, { ...value, response: { ...response, result: {} } }]) {
      await fails(() => owner("select private.resolve_local_quiz_receipt_v1(jsonb_populate_record(r,$2::jsonb)) from private.local_quiz_phase_receipts r where submission_id=$1",
        [batch.submissionId, { result }]), "local_quiz_receipt_invalid");
    }
    await fails(() => owner("select private.resolve_local_quiz_receipt_v1(jsonb_populate_record(r,$2::jsonb)) from private.local_quiz_phase_receipts r where submission_id=$1",
      [batch.submissionId, { attempt_id: randomUUID() }]), "local_quiz_receipt_invalid");
    const unsubmitted = await start();
    await fails(() => owner("select private.resolve_local_quiz_receipt_v1(jsonb_populate_record(r,$2::jsonb)) from private.local_quiz_phase_receipts r where submission_id=$1",
      [batch.submissionId, { attempt_id: unsubmitted.attemptId, result: { ...value, response: { ...response, planHash: unsubmitted.planHash } } }]), "local_quiz_receipt_invalid");
    expect(await stored(batch.submissionId)).toEqual(row);
  });

  it("같은 제출의 다른 답을 거절하고 마지막 INSERT 실패는 전체 학생 기록을 되돌린다", async () => {
    const plan = await start(); const batch = makeBatch(plan); await elapsed(plan, batch.completion.elapsedMs);
    const before = await snapshot();
    await ownerExec("create function pg_temp.fail_phase_receipt() returns trigger language plpgsql as $$ begin raise exception 'synthetic_receipt_failure'; end $$; create trigger a908_fail before insert on private.local_quiz_phase_receipts for each row execute function pg_temp.fail_phase_receipt()");
    await fails(() => submit(batch), "synthetic_receipt_failure");
    expect(await snapshot()).toEqual(before);
    await owner("drop trigger a908_fail on private.local_quiz_phase_receipts");
    const original = await submit(batch); await confirm(batch, original);
    const after = await snapshot();
    const changed = { ...batch, answers: batch.answers.map((a, i) => i === 0 ? { ...a, choice: (a.choice! + 1) % 4 } : a) };
    await fails(() => submit(changed), "local_quiz_submission_conflict");
    expect(await snapshot()).toEqual(after);
  });

  it("저장 직후 원형 검산이 실패해도 답과 결과 전체를 취소한다", async () => {
    const plan = await start(); const batch = makeBatch(plan, 2); await elapsed(plan, batch.completion.elapsedMs);
    const before = await snapshot();
    await ownerExec("create function pg_temp.corrupt_phase_receipt() returns trigger language plpgsql as $$ begin new.result:=jsonb_set(new.result,'{responseSha256}',to_jsonb(repeat('0',64)));return new;end $$;create trigger a908_corrupt before insert on private.local_quiz_phase_receipts for each row execute function pg_temp.corrupt_phase_receipt()");
    await fails(() => submit(batch), "local_quiz_receipt_invalid");
    expect(await snapshot()).toEqual(before);
    await owner("drop trigger a908_corrupt on private.local_quiz_phase_receipts");
    await confirm(batch, await submit(batch));
  });

  it("문항 시간초과와 원래 접수 시각을 실제 경과시간으로 보존한다", async () => {
    const plan = await start(1, "per_question"); const batch = makeBatch(plan);
    batch.answers[0] = { ...batch.answers[0], kind: "timeout", choice: null, elapsedMs: 5000 };
    batch.completion.elapsedMs = 5000;
    await elapsed(plan, 5000);
    const original = await submit(batch); const before = await stored(batch.submissionId);
    await confirm(batch, original);
    expect(await stored(batch.submissionId)).toEqual(before);
    expect((await owner("select outcome,accepted_at from private.vocabulary_answer_receipts where attempt_id=$1", [plan.attemptId]))[0]).toMatchObject({ outcome: "timeout" });
  }, 15_000);

  it("총시간 종료의 미응답 배열과 점수를 순서대로 복원한다", async () => {
    const plan = await start(4, "total"); const batch = makeBatch(plan);
    batch.answers = batch.answers.map((answer, i) => i === 0 ? answer : { ...answer, kind: "unanswered", choice: null, openedMs: 100, elapsedMs: plan.limitMs! });
    batch.completion = { elapsedMs: plan.limitMs!, reason: "deadline" };
    await elapsed(plan, plan.limitMs!);
    const response = await confirm(batch, await submit(batch));
    expect(response.result).toMatchObject({ finalized: true, attempt: { finalScore: 25, passed: false } });
    const outcomes = await owner("select outcome from private.vocabulary_answer_receipts where attempt_id=$1 order by server_sequence", [plan.attemptId]);
    expect(outcomes.map(row => row.outcome)).toEqual(["correct", "unanswered", "unanswered", "unanswered"]);
  }, 45_000);

  it("내부 복원 함수의 앱 접근을 막고 기존 불변 보호를 유지한다", async () => {
    const privileges = await owner(`select rolname,p.proname,has_function_privilege(r.oid,p.oid,'EXECUTE') allowed
      from pg_roles r cross join pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where rolname in('anon','authenticated','service_role') and n.nspname='private'
      and p.proname in('local_quiz_receipt_accepted_v1','resolve_local_quiz_receipt_v1','compact_local_quiz_receipt_v1')`);
    expect(privileges).toHaveLength(9); expect(privileges.every(row => row.allowed === false)).toBe(true);
    const triggers = await owner("select tgname,tgenabled from pg_trigger where tgname in('local_quiz_receipts_immutable','local_quiz_plans_immutable')");
    expect(triggers).toHaveLength(2); expect(triggers.every(row => row.tgenabled === "O")).toBe(true);
    await fails(() => owner("update private.local_quiz_phase_receipts set result='{}' where submission_id=$1", [legacy.batch.submissionId]), "mock_wordbook_history_is_immutable");
    expect(await stored(legacy.batch.submissionId)).toEqual(legacy.stored);
  });
});
