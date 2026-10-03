import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { localPhasePlanSchema, localReceiptSchema, type LocalBatch, type LocalPhasePlan } from "@/features/quiz-player/contracts/local-quiz";
import { receiptConfirmsBatch } from "@/features/quiz-player/domain/local-quiz";

const migration = "20261003235500_compact_local_quiz_phase_plans.sql";
const id = (n: number) => `a9110000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), student = id(2), dataset = id(4), unit = id(5), device = "d".repeat(64);
type Json = Record<string, unknown>;
type Prepared = { preparationId: string; planHash: string };

describe.sequential("시험 회차 목록의 작은 저장과 원형 복원", () => {
  let db: PGlite;
  const legacy: { batch: LocalBatch; response: Json; row: Json }[] = [];
  let pending: LocalPhasePlan, preparedBefore: Prepared, beforeSnapshot: Json, beforeMeta: unknown, oldWriter: string;
  async function owner<T = Json>(sql: string, values: unknown[] = []) {
    await db.exec("reset role");
    return (await db.query<T>(sql, values)).rows;
  }
  async function ownerExec(sql: string) { await db.exec("reset role"); await db.exec(sql); }
  async function rpc(name: string, values: unknown[]) {
    await db.exec("set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
    return (await db.query<{ value: unknown }>(`select public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) value`, values)).rows[0].value;
  }
  async function zone(value: string) { await owner("select set_config('TimeZone',$1,false)", [value]); }
  async function metadata() {
    return (await owner(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,
      'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid) from pg_proc where proname in
      ('create_local_quiz_phase_plan_v1','read_local_quiz_plan_v1','submit_local_quiz_phase_v1','local_quiz_receipt_accepted_v1')),
      'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname)
        from pg_constraint where conrelid='private.local_quiz_phase_plans'::regclass and conname<>'local_quiz_phase_plans_plan_check'),
      'trigger',(select jsonb_agg(to_jsonb(t) order by t.tgname) from pg_trigger t where tgrelid='private.local_quiz_phase_plans'::regclass)) value`))[0].value;
  }
  async function snapshot() {
    const current = String((await owner("select current_setting('TimeZone') value"))[0].value);
    await zone("UTC");
    const tables = await owner<{ name: string }>(`select format('%I.%I',n.nspname,c.relname) name from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in('public','private') and c.relkind='r' order by 1`);
    const result: Json = {};
    for (const { name } of tables) result[name] = (await owner(`select count(*)::integer rows,
      md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) hash from ${name} t`))[0];
    await zone(current); return result;
  }
  async function prepare(count = 4) {
    const assignment = randomUUID();
    await owner(`with created as (insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,
      time_limit_seconds,timing_mode,passing_score,status,created_by,retake_allowed,retry_enabled,retry_passing_score)
      values($1,'가짜 회차 목록 시험',$2,1,$3,$3,100,30,'none',80,'active',$4,true,true,80) returning id),
      linked as (insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
        select id,$2,$5,1,true from created returning assignment_id)
      insert into public.assignment_students(assignment_id,student_id,assigned_by) select assignment_id,$6,$4 from linked`,
    [assignment, dataset, count, admin, unit, student]);
    const questions = (await owner(`select jsonb_agg(jsonb_build_object('vocab_entry_id',e.id,'order_index',e.source_row,'direction','english_to_korean',
      'prompt',e.headword,'choices',jsonb_build_array(e.primary_meaning,'다른 가짜 뜻 A','다른 가짜 뜻 B','다른 가짜 뜻 C'),
      'correct_choice_index',0) order by e.source_row) value from public.vocab_entries e where dataset_id=$1 and source_row<=$2`, [dataset, count]))[0].value;
    return await rpc("prepare_local_quiz_v1", [student, assignment, device, questions]) as Prepared;
  }
  async function begin(prepared: Prepared) {
    return localPhasePlanSchema.parse(await rpc("begin_local_quiz_v1", [student, prepared.preparationId, device, prepared.planHash]));
  }
  async function start(count = 4) { return begin(await prepare(count)); }
  function batch(plan: LocalPhasePlan, wrong = 0): LocalBatch {
    const answers = plan.items.map((q, i) => ({ id: q.id, order: i + 1, kind: "answer" as const,
      choice: i < wrong ? (q.correctChoiceIndex + 1) % 4 : q.correctChoiceIndex, openedMs: i * 100, elapsedMs: i * 100 }));
    return { submissionId: randomUUID(), attemptId: plan.attemptId, phase: plan.phase, planHash: plan.planHash, answers,
      completion: { elapsedMs: answers.at(-1)!.elapsedMs, reason: "answered" } };
  }
  async function elapsed(plan: LocalPhasePlan, milliseconds: number) {
    const passed = Number((await owner("select extract(epoch from(clock_timestamp()-$1::timestamptz))*1000 elapsed", [plan.startedAt]))[0].elapsed);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds - passed + 30)));
  }
  async function submit(value: LocalBatch) {
    return await rpc("submit_local_quiz_phase_v1", [student, value.attemptId, value.phase, device, value.planHash, value.submissionId, value.answers, value.completion]) as Json;
  }
  async function finish(plan: LocalPhasePlan, wrong = 0) {
    const value = batch(plan, wrong); await elapsed(plan, value.completion.elapsedMs);
    const response = await submit(value), parsed = localReceiptSchema.parse(response);
    expect(await receiptConfirmsBatch(value, parsed)).toBe(true);
    return { batch: value, response };
  }
  async function row(plan: Pick<LocalPhasePlan, "attemptId" | "phase">) {
    return (await owner("select to_jsonb(p) value from private.local_quiz_phase_plans p where attempt_id=$1 and phase=$2", [plan.attemptId, plan.phase]))[0].value as Json;
  }
  async function read(plan: LocalPhasePlan) {
    return localPhasePlanSchema.parse(await rpc("read_local_quiz_plan_v1", [student, plan.attemptId, device, plan.phase]));
  }
  async function resolve(plan: LocalPhasePlan, changed: Json = {}) {
    return (await owner("select private.resolve_local_quiz_phase_plan_v1(jsonb_populate_record(p,$3::jsonb)) value from private.local_quiz_phase_plans p where attempt_id=$1 and phase=$2",
      [plan.attemptId, plan.phase, changed]))[0].value;
  }
  async function fails(action: () => Promise<unknown>, message: string) {
    await db.exec("savepoint expected_failure");
    try { await expect(action()).rejects.toThrow(message); }
    finally { await db.exec("rollback to expected_failure;release expected_failure"); }
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if (name !== migration) return;
      db = database;
      await db.exec("grant usage on schema auth,extensions to service_role;alter role service_role bypassrls;set time zone 'Asia/Seoul'");
      await ownerExec(`begin;insert into auth.users(id)values('${admin}');
        insert into public.admin_profiles(user_id,display_name)values('${admin}','가짜 회차 관리자');
        insert into public.students(id,display_name,status,created_by)values('${student}','가짜 회차 학생','active','${admin}');
        insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
          values('${dataset}','phase-plan-fake','가짜 회차 자료','fake',repeat('A',64),500,'ready','${admin}');
        insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
          values('${unit}','${dataset}','DAY 1','day1','day',1,1,500);
        insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
          select '${dataset}',n,'phaseword'||n,'phaseword'||n,array['가짜 뜻 '||n],'가짜 뜻 '||n,
            upper(encode(extensions.digest('phase:'||n,'sha256'),'hex')),'${unit}',n,'word' from generate_series(1,500)n;commit;begin;`);
      for (const count of [1, 4]) { const plan = await start(count); legacy.push({ ...await finish(plan), row: await row(plan) }); }
      pending = await start(); await zone("UTC"); preparedBefore = await prepare();
      oldWriter = String((await owner("select pg_get_functiondef('private.create_local_quiz_phase_plan_v1(uuid,text)'::regprocedure) value"))[0].value);
      beforeMeta = await metadata(); await ownerExec("commit");
      beforeSnapshot = await snapshot();
    } });
  }, 120_000);
  beforeEach(async () => { await db.exec("reset role;begin;set time zone 'UTC'"); });
  afterEach(async () => { await db.exec("rollback;reset role"); });
  afterAll(async () => { await db?.close(); });

  it("적용 전 모든 학생 표와 계획·준비·접수 및 기존 함수 권한을 보존한다", async () => {
    expect(await snapshot()).toEqual(beforeSnapshot); expect(await metadata()).toEqual(beforeMeta);
    for (const old of legacy) {
      expect(Array.isArray((await row(old.batch)).plan)).toBe(true);
      expect(await submit(old.batch)).toEqual(old.response);
    }
    expect(await snapshot()).toEqual(beforeSnapshot);
    expect((await read(pending)).items).toEqual(pending.items);
    const completed = await finish(pending); expect(await submit(completed.batch)).toEqual(completed.response);
    expect((await begin(preparedBefore)).items).toHaveLength(4);
  });

  it.each([1, 4, 50, 500])("%i문항의 저장 선택·내용키·순서·서명을 원래 배열과 일치시킨다", async count => {
    const plan = await start(count), stored = await row(plan);
    const original = plan.items.map(q => ({ id: q.id, order: q.order, contentId: q.contentId }));
    expect(await resolve(plan)).toEqual(original);
    expect((await read(plan)).items).toEqual(plan.items);
    const sizes = (await owner("select pg_column_size($1::jsonb)::integer stored,pg_column_size($2::jsonb)::integer original", [stored.plan, original]))[0];
    expect(Number(sizes.stored)).toBeLessThanOrEqual(Number(sizes.original));
    if (count === 1) expect(stored.plan).toEqual(original);
    else {
      expect(stored.plan).toMatchObject({ storageVersion: "local-quiz-phase-refs-v1", questionIds: original.map(q => q.id) });
      expect(Object.keys(stored.plan as Json).sort()).toEqual(["questionIds", "startedAt", "storageVersion"]);
    }
    console.log(JSON.stringify({ phaseQuestionCount: count, ...sizes }));
  });

  it("서로 다른 시간대와 준비 삭제 후에도 최초·재시험·옛 접수의 당시 응답을 복원한다", async () => {
    await zone("Asia/Kathmandu"); const plan = await start(), first = await finish(plan, 2);
    await zone("America/New_York");
    expect((await read(plan)).planHash).toBe(plan.planHash);
    const retry = localPhasePlanSchema.parse(await rpc("begin_local_quiz_retry_v1", [student, plan.attemptId, device]));
    expect(retry.items.map(q => q.id)).toEqual(plan.items.slice(0, 2).map(q => q.id));
    await zone("Pacific/Chatham"); const second = await finish(retry);
    const next = await start(); await finish(next, 1);
    await owner("delete from private.quiz_attempt_preparations where id=$1", [plan.attemptId]);
    expect((await owner("select count(*)::integer n from private.local_quiz_preparations where preparation_id=$1", [plan.attemptId]))[0].n).toBe(0);
    await owner("set constraints all immediate");
    const before = await snapshot(); await zone("UTC");
    for (const value of [first, second, ...legacy]) expect(await submit(value.batch)).toEqual(value.response);
    expect((await read(retry)).items).toEqual(retry.items);
    expect(await snapshot()).toEqual(before);
  });

  it("잘못된 참조·순서·시각·해시를 읽기 성공으로 돌려주지 않는다", async () => {
    const plan = await start(), stored = (await row(plan)).plan as Json, ids = stored.questionIds as string[];
    const other = await start();
    const invalid = [null, {}, { ...stored, storageVersion: null }, { ...stored, extra: true }, { ...stored, questionIds: null },
      { ...stored, questionIds: [] }, { ...stored, questionIds: Array.from({ length: 501 }, () => ids[0]) },
      { ...stored, questionIds: [null, ...ids.slice(1)] }, { ...stored, questionIds: [17, ...ids.slice(1)] },
      { ...stored, questionIds: ["bad-id", ...ids.slice(1)] }, { ...stored, questionIds: [ids[0], ids[0], ...ids.slice(2)] },
      { ...stored, questionIds: [randomUUID(), ...ids.slice(1)] }, { ...stored, questionIds: [other.items[0].id, ...ids.slice(1)] },
      { ...stored, questionIds: [...ids].reverse() }, { ...stored, startedAt: null }, { ...stored, startedAt: "2026-02-31T00:00:00+00:00" },
      { ...stored, startedAt: "2026-10-03T00:00:00+00:00" }];
    const before = await snapshot();
    for (const value of invalid) await fails(() => resolve(plan, { plan: value }), "local_quiz_plan_invalid");
    for (const changed of [{ plan_hash: "0".repeat(64) }, { attempt_id: other.attemptId }, { phase: "retry" }, { limit_ms: 17 }, { question_limit_ms: 5000 }]) {
      await fails(() => resolve(plan, changed), "local_quiz_plan_invalid");
    }
    await fails(() => owner("update public.quiz_questions set content_version_id=null where id=$1", [ids[0]]), "question_content_reference_immutable");
    expect(await snapshot()).toEqual(before);
  });

  it("JSON CHECK의 누락·null 우회와 기존 불변 수정 및 직접 실행을 차단한다", async () => {
    const plan = await start(), stored = (await row(plan)).plan as Json;
    await owner("create temporary table plan_shape_probe (like private.local_quiz_phase_plans including constraints) on commit drop");
    for (const value of [null, {}, { questionIds: stored.questionIds, startedAt: stored.startedAt }, { ...stored, storageVersion: null },
      { ...stored, questionIds: {} }, { ...stored, questionIds: null }, { ...stored, questionIds: [] }, { ...stored, startedAt: null }, { ...stored, extra: 1 }]) {
      await fails(() => owner(`insert into plan_shape_probe select (jsonb_populate_record(p,$2::jsonb)).* from private.local_quiz_phase_plans p where attempt_id=$1`,
        [plan.attemptId, { plan: value }]), value === null ? "violates not-null constraint" : "violates check constraint");
    }
    await fails(() => owner("update private.local_quiz_phase_plans set plan_hash=repeat('0',64) where attempt_id=$1", [plan.attemptId]), "immutable");
    const privileges = await owner(`select role,has_function_privilege(role,'private.resolve_local_quiz_phase_plan_v1(private.local_quiz_phase_plans)','execute') allowed
      from unnest(array['anon','authenticated','service_role']) role`);
    expect(privileges.every(v => v.allowed === false)).toBe(true);
    await fails(() => rpc("read_local_quiz_plan_v1", [student, plan.attemptId, "b".repeat(64), plan.phase]), "local_quiz_device_required");
  });

  it("계획 마지막 저장 실패는 전체 거래를 취소하고 이전 생성기로도 새 형식을 읽는다", async () => {
    const prepared = await prepare(), before = await snapshot();
    await ownerExec("create function pg_temp.fail_phase_plan() returns trigger language plpgsql as $$ begin raise exception 'synthetic_phase_plan_failure'; end $$; create trigger a911_fail before insert on private.local_quiz_phase_plans for each row execute function pg_temp.fail_phase_plan()");
    await fails(() => begin(prepared), "synthetic_phase_plan_failure");
    expect(await snapshot()).toEqual(before);
    await owner("drop trigger a911_fail on private.local_quiz_phase_plans");
    const compact = await begin(prepared); expect(Array.isArray((await row(compact)).plan)).toBe(false);
    await ownerExec(oldWriter);
    const original = await start(); expect(Array.isArray((await row(original)).plan)).toBe(true);
    for (const plan of [compact, original]) { const done = await finish(plan); expect(await submit(done.batch)).toEqual(done.response); }
  });
});
