import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { studentDashboardInitialRowSchema } from "@/features/student-dashboard/server/queries/student-dashboard-row-schema";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Release = { state: string; opensAt: string | null; hasDeadline: boolean };
type QueueItem = { id: string; status: string; completed_at: Date | null; deferred_at: Date | null };
const waitRemovalMigration = "20260907084627_remove_predecessor_twelve_hour_wait.sql";

// Real final schema, fake students only. Sequential transaction/rollback tests;
// this does not claim to simulate two independent PostgreSQL connections.
describe.sequential("APP0704 첫 시험·자체 예약·보류 전체 스키마", () => {
  let db: PGlite;
  beforeAll(async () => { db = await createFinalSchemaDatabase(); }, 120_000);
  afterAll(async () => { await db?.close(); });
  async function seed(database: PGlite, transaction = true) {
    await database.exec(`
      ${transaction ? "begin;" : ""}
      select set_config('request.jwt.claim.sub','${id(1)}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claims','{"role":"authenticated"}',true);
      insert into auth.users(id) values('${id(1)}');
      insert into admin_profiles(user_id,display_name,is_active) values('${id(1)}','가짜 관리자',true);
      insert into students(id,display_name,status,created_by)
        values('${id(2)}','가짜 학생','active','${id(1)}'),('${id(3)}','다른 가짜 학생','active','${id(1)}');
      insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${id(4)}','release-test','공개 검사','가상',repeat('A',64),4,'ready','${id(1)}');
      insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${id(100)}','${id(4)}','DAY 1','day 1','day',1,1,4);
      insert into assignments(id,title,dataset_id,range_start,range_end,question_count,
        time_limit_seconds,passing_score,status,created_by,retake_allowed)
        select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          n::text||'회차','${id(4)}',1,4,4,300,80,'active','${id(1)}',true from generate_series(10,16) n;
      insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
        select id,'${id(4)}','${id(100)}',1,true from assignments;
      insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at)
        select id,'${id(2)}','${id(1)}',clock_timestamp()-interval '10 days' from assignments;
    `);
  }
  beforeEach(async () => { await seed(db); });
  afterEach(async () => { await db.exec("rollback; reset role;"); });

  async function receipt(numbers = [10, 11, 12], request = 40, database = db) {
    const result = numbers.map((n, index) => ({ student_id: id(2), assignment_id: id(n), session_number: index + 1 }));
    await database.query(`insert into private.bulk_vocab_series_requests
      (idempotency_key,request_sha256,payload_sha256,actor_admin_id,result,completed_at)
      values($1,repeat('a',64),repeat('b',64),$2,$3,clock_timestamp())`, [id(request),id(1),JSON.stringify(result)]);
    return result;
  }
  async function gate(assignment = 11, at = new Date().toISOString(), student = 2) {
    return (await db.query<{ value: Release }>("select private.student_assignment_release_v1($1,$2,$3) value",
      [id(student),id(assignment),at])).rows[0]!.value;
  }
  async function start(assignment = 10, attempt = 60, number = 1, database = db) {
    await database.query(`insert into quiz_attempts(id,student_id,assignment_id,attempt_number,deadline_at,
      question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
      values($1,$2,$3,$4,clock_timestamp()+interval '2 hours',4,300,80,'initial')`,
    [id(attempt),id(2),id(assignment),number]);
  }
  async function finishFirst(at = new Date().toISOString(), attempt = 60, database = db) {
    await database.query(`update quiz_attempts set phase='review',initial_completed_at=$1,
      initial_correct_count=2,retry_correct_count=0,unresolved_wrong_count=2,
      initial_score=50,elapsed_seconds=1 where id=$2`, [at,id(attempt)]);
  }
  async function answeredQuestion(database: PGlite) {
    await database.query(`with word as (
      insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,
        unit_id,position_in_unit,entry_type)
        values($1,1,'sample','sample',array['예시'],'예시',repeat('B',64),$4,1,'word') returning id
    ) insert into quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,
      correct_choice_index,initial_choice_index,initial_is_correct,initial_answered_at)
      select $2,$3,id,1,'english_to_korean','sample','["예시","다른 뜻","가상 뜻","검사 뜻"]',0,1,false,clock_timestamp() from word`,
    [id(4),id(80),id(60),id(100)]);
  }
  async function reject(operation: () => Promise<unknown>, pattern: RegExp) {
    await db.exec("savepoint expected_rejection");
    await expect(operation()).rejects.toThrow(pattern);
    await db.exec("rollback to expected_rejection; release expected_rejection");
  }
  async function datedQueue(status = "assigned", nextExpired = false, database = db) {
    await database.exec(`
      insert into private.vocab_assignment_queue_requests
        (idempotency_key,request_sha256,payload_sha256,actor_admin_id)
        values('${id(40)}',repeat('a',64),repeat('b',64),'${id(1)}');
      insert into private.vocab_assignment_series
        (id,request_id,student_id,dataset_id,actor_admin_id,dataset_label,range_label,recurrence_slots,status,attention_reason)
        values('${id(41)}','${id(40)}','${id(2)}','${id(4)}','${id(1)}','가상','1~3',
          '[{"isodow":1,"local_time":"09:00","duration_seconds":3600}]',
          '${status === "attention" ? "attention" : "active"}',${status === "attention" ? "'assignment_expired'" : "null"});
      insert into private.vocab_assignment_series_items
        (id,series_id,sequence_number,status,question_count,unit_ids,unit_labels,
         planned_available_from,planned_available_until,effective_available_from,effective_available_until,
         payload,assignment_id,materialized_at,attention_reason)
        values('${id(50)}','${id(41)}',1,'${status}',4,array['${id(100)}'::uuid],array['1'],
          clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 hour',
          clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 hour',
          '{"retry_enabled":true,"retry_passing_score":80,"passing_score":80}','${id(10)}',clock_timestamp(),${status === "attention" ? "'assignment_expired'" : "null"});
      insert into private.vocab_assignment_series_items
        (id,series_id,sequence_number,status,question_count,unit_ids,unit_labels,
         planned_available_from,planned_available_until,effective_available_from,effective_available_until,payload)
        values('${id(51)}','${id(41)}',2,'queued',4,array['${id(100)}'::uuid],array['2'],
          clock_timestamp()+interval '${nextExpired ? "-2 days" : "13 hours"}',
          clock_timestamp()+interval '${nextExpired ? "-1 day" : "14 hours"}',
          clock_timestamp()+interval '${nextExpired ? "-2 days" : "13 hours"}',
          clock_timestamp()+interval '${nextExpired ? "-1 day" : "14 hours"}','{"retry_enabled":true,"retry_passing_score":80,"passing_score":80}');
      update assignments set available_until=clock_timestamp()+interval '1 hour' where id='${id(10)}';
    `);
  }
  async function items() {
    return (await db.query<QueueItem>("select id,status,completed_at,deferred_at from private.vocab_assignment_series_items order by sequence_number")).rows;
  }
  async function replacement(database: PGlite, from: number, to: number, request: number) {
    await database.query(`insert into private.assignment_replacement_requests
      (idempotency_key,request_sha256,payload_sha256,actor_admin_id,source_assignment_id,student_id,
       replacement_kind,replacement_assignment_id,result,completed_at)
      values($1,repeat('c',64),repeat('d',64),$2,$3,$4,'regular',$5,'{}',clock_timestamp())`,
    [id(request),id(1),id(from),id(2),id(to)]);
  }
  async function protectedFingerprint(database: PGlite) {
    const snapshot = await database.query(`select
      (select jsonb_agg(to_jsonb(s) order by id) from students s) students,
      (select jsonb_agg(to_jsonb(a) order by id) from assignments a) assignments,
      (select jsonb_agg(to_jsonb(r) order by assignment_id,student_id) from assignment_students r) recipients,
      (select jsonb_agg(to_jsonb(a) order by id) from quiz_attempts a) attempts,
      (select jsonb_agg(to_jsonb(q) order by id) from quiz_questions q) questions,
      (select jsonb_agg(to_jsonb(r) order by idempotency_key) from private.bulk_vocab_series_requests r) receipts`);
    return createHash("sha256").update(JSON.stringify(snapshot.rows)).digest("hex");
  }

  it("기존 저장·다단계 교체 관계를 소급하며 이미 시작한 응시와 원본 영수증 지문을 보존한다", async () => {
    let before = "";
    const legacy = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if (name !== "20260906130402_add_first_attempt_assignment_release.sql") return;
      await seed(database,false);
      await receipt([10,11,12],40,database);
      await start(12,61,1,database);
      await replacement(database,10,14,70);
      await replacement(database,14,15,71);
      await replacement(database,11,13,72);
      await database.exec(`update assignment_students set cancelled_at=clock_timestamp(),
        cancelled_by='${id(1)}',cancellation_reason='가상 교체'
        where assignment_id in ('${id(10)}','${id(14)}','${id(11)}')`);
      before = await protectedFingerprint(database);
    } });
    try {
      const links = await legacy.query("select assignment_id,previous_assignment_id,original_assignment_id from private.assignment_release_links_v1 order by sequence_number");
      expect(links.rows).toEqual([
        {assignment_id:id(13),previous_assignment_id:id(15),original_assignment_id:id(11)},
        {assignment_id:id(12),previous_assignment_id:id(13),original_assignment_id:id(12)},
      ]);
      expect(await protectedFingerprint(legacy)).toBe(before);
      expect((await legacy.query("select id,status,phase from quiz_attempts")).rows).toEqual([{id:id(61),status:"in_progress",phase:"initial"}]);
    } finally { await legacy.close(); }
  },30_000);

  it("과거 명시 건너뛰기는 보류로 소급하되 이후의 전체 취소는 해제하지 않는다", async () => {
    let before = "";
    const legacy = await createFinalSchemaDatabase({ beforeMigration: async (database,name) => {
      if (name !== "20260906130402_add_first_attempt_assignment_release.sql") return;
      await seed(database,false);
      await datedQueue("attention",true,database);
      await database.exec(`
        update private.vocab_assignment_series_items set status='cancelled',cancelled_at=clock_timestamp(),attention_reason=null where id='${id(50)}';
        insert into private.vocab_assignment_series_events(series_id,item_id,assignment_id,event_kind,details)
          values('${id(41)}','${id(50)}','${id(10)}','session.skipped','{"action":"skip"}');
        update private.vocab_assignment_series_items set status='cancelled',assignment_id='${id(11)}',
          materialized_at=clock_timestamp(),cancelled_at=clock_timestamp() where id='${id(51)}';
        update private.vocab_assignment_series set status='cancelled',cancelled_at=clock_timestamp(),attention_reason=null where id='${id(41)}';
      `);
      before = await protectedFingerprint(database);
    } });
    try {
      expect((await legacy.query("select status from private.vocab_assignment_series_items order by sequence_number")).rows)
        .toEqual([{status:"deferred"},{status:"cancelled"}]);
      expect((await legacy.query("select private.student_assignment_release_v1($1,$2,clock_timestamp())->>'state' state",[id(2),id(11)])).rows)
        .toEqual([{state:"cancelled"}]);
      expect(await protectedFingerprint(legacy)).toBe(before);
    } finally { await legacy.close(); }
  },30_000);

  it("기존 첫 완료·재시험 대기 상태를 소급해 다음 회차만 준비하고 응시를 보존한다", async () => {
    let before = "";
    const legacy = await createFinalSchemaDatabase({ beforeMigration: async (database,name) => {
      if (name !== "20260906130402_add_first_attempt_assignment_release.sql") return;
      await seed(database,false);
      await datedQueue("assigned",false,database);
      await start(10,60,1,database);
      await finishFirst(new Date().toISOString(),60,database);
      expect((await database.query("select status from private.vocab_assignment_series_items order by sequence_number")).rows)
        .toEqual([{status:"assigned"},{status:"queued"}]);
      before = await protectedFingerprint(database);
    } });
    try {
      expect((await legacy.query("select status from private.vocab_assignment_series_items order by sequence_number")).rows)
        .toEqual([{status:"completed"},{status:"ready"}]);
      expect(await protectedFingerprint(legacy)).toBe(before);
    } finally { await legacy.close(); }
  },30_000);

  it("현재 첫·중간 회차 교체도 기존 링크와 후속 링크를 함께 바꾸고 원본 영수증은 유지한다", async () => {
    const original = await receipt();
    await replacement(db,10,14,70);
    await replacement(db,11,13,71);
    await replacement(db,14,15,72);
    expect((await db.query("select assignment_id,previous_assignment_id from private.assignment_release_links_v1 order by sequence_number")).rows)
      .toEqual([{assignment_id:id(13),previous_assignment_id:id(15)},{assignment_id:id(12),previous_assignment_id:id(13)}]);
    await db.query("select private.register_assignment_release_links_v1($1,$2)",[id(40),JSON.stringify(original)]);
    expect((await db.query<{result:unknown}>("select result from private.bulk_vocab_series_requests")).rows[0]!.result).toEqual(original);
  });

  it("중복·누락 회차와 다른 요청의 관계 충돌은 임의 연결하지 않는다", async () => {
    await receipt();
    for (const result of [
      [{student_id:id(2),assignment_id:id(10),session_number:1},{student_id:id(2),assignment_id:id(11),session_number:1}],
      [{student_id:id(2),assignment_id:id(10),session_number:1},{student_id:id(2),assignment_id:id(11),session_number:3}],
    ]) {
      await reject(() => db.query("select private.register_assignment_release_links_v1($1,$2)",[id(40),JSON.stringify(result)]),/assignment_release_receipt_invalid/u);
    }
    await reject(() => receipt([10,11],41),/assignment_release_relationship_ambiguous/u);
    expect((await db.query("select * from private.assignment_release_links_v1")).rows).toHaveLength(2);
  });

  it("날짜 없는 실제 저장 관계만 연결하고 첫 시험 미달이어도 재시험을 기다리지 않는다", async () => {
    const source = await receipt();
    expect((await gate()).state).toBe("waiting_initial");
    await reject(() => start(11), /assignment_release_waiting_initial/u);
    const study = (await db.query<{ value: Record<string,unknown> }>("select get_student_assignment_study_v1($1,$2) value",[id(2),id(11)])).rows[0]!.value;
    expect(study).toMatchObject({ assignmentId: id(11), release: { state: "waiting_initial" } });
    expect(Object.keys(study).sort()).toEqual(["assignmentId","mode","release","title"]);
    expect(await gate(11, undefined, 3)).toMatchObject({ state: "unavailable" });
    await start();
    await finishFirst();
    expect((await gate()).state).toBe("open");
    expect((await gate(12)).state).toBe("waiting_initial");
    await start(11,61);
    await db.query("select private.register_assignment_release_links_v1($1,$2)",[id(40),JSON.stringify(source)]);
    expect((await db.query("select * from private.assignment_release_links_v1")).rows).toHaveLength(2);
    expect((await db.query<{ result: unknown }>("select result from private.bulk_vocab_series_requests")).rows[0]!.result).toEqual(source);
    expect((await db.query("select status,phase,initial_score,final_score from quiz_attempts where id=$1",[id(60)])).rows[0])
      .toMatchObject({ status: "in_progress", phase: "review", initial_score: "50.00", final_score: null });
  });

  it("앞 마감12시간은 제거하고 다음 자체 예약 직전·정각·직후를 지킨다", async () => {
    await receipt();
    await start();
    await finishFirst("2030-01-01T00:00:00Z");
    await db.exec(`update assignments set available_until='2030-01-01T03:00:00Z' where id='${id(10)}';
      update assignments set available_from='2030-01-01T04:00:00Z', available_until='2030-01-02T00:00:00Z' where id='${id(11)}'`);
    const before = await gate(11,"2030-01-01T03:59:59.999Z");
    expect(before.state).toBe("waiting_time");
    expect(before.hasDeadline).toBe(false);
    expect(Date.parse(before.opensAt!)).toBe(Date.parse("2030-01-01T04:00:00Z"));
    expect((await gate(11,"2030-01-01T04:00:00Z")).state).toBe("open");
    expect((await gate(11,"2030-01-01T04:00:00.001Z")).state).toBe("open");
    expect((await gate(11,"2029-12-31T23:59:59Z")).state).toBe("waiting_initial");
  });

  it("자체 예약보다 늦은 첫 완료까지 기다리되 재시험·앞 마감은 기다리지 않는다", async () => {
    await receipt();
    await start();
    await finishFirst("2030-01-01T06:00:00Z");
    await db.exec(`update assignments set available_until='2030-01-02T00:00:00Z' where id='${id(10)}';
      update assignments set available_from='2030-01-01T04:00:00Z', available_until='2030-01-02T00:00:00Z' where id='${id(11)}'`);
    expect((await gate(11,"2030-01-01T05:59:59.999Z")).state).toBe("waiting_initial");
    const release = await gate(11,"2030-01-01T06:00:00Z");
    expect(release.state).toBe("open");
    expect(Date.parse(release.opensAt!)).toBe(Date.parse("2030-01-01T06:00:00Z"));
    expect((await db.query("select status,phase from quiz_attempts")).rows)
      .toEqual([{status:"in_progress",phase:"review"}]);
  });

  it("앞 마감12시간과 겹치는 다음 회차도 자체 마감 전이면 준비하고 날짜는 이동하지 않는다", async () => {
    await datedQueue();
    await db.query(`update private.vocab_assignment_series_items set
      effective_available_from=clock_timestamp()+interval '1 hour',
      effective_available_until=clock_timestamp()+interval '2 hours' where id=$1`, [id(51)]);
    const dates = (await db.query(`select planned_available_from,planned_available_until,
      effective_available_from,effective_available_until from private.vocab_assignment_series_items order by id`)).rows;
    await start();
    await finishFirst();
    expect((await items()).map(i=>i.status)).toEqual(["completed","ready"]);
    expect((await db.query(`select planned_available_from,planned_available_until,
      effective_available_from,effective_available_until from private.vocab_assignment_series_items order by id`)).rows).toEqual(dates);
  });

  it("기존 생성 시험은 날짜·진행응시를 바꾸지 않고 새 공개 조건을 즉시 따른다", async () => {
    let before = "";
    const legacy = await createFinalSchemaDatabase({beforeMigration: async (database,name) => {
      if (name !== waitRemovalMigration) return;
      await seed(database,false);
      await receipt([10,11],40,database);
      await start(10,60,1,database);
      await answeredQuestion(database);
      await finishFirst(new Date().toISOString(),60,database);
      await database.exec(`update assignments set available_until=clock_timestamp()+interval '1 hour' where id='${id(10)}';
        update assignments set available_from=clock_timestamp()-interval '1 hour',available_until=clock_timestamp()+interval '20 hours' where id='${id(11)}'`);
      expect((await database.query(`select private.student_assignment_release_v1($1,$2,clock_timestamp())->>'state' state`,[id(2),id(11)])).rows)
        .toEqual([{state:"waiting_time"}]);
      before = await protectedFingerprint(database);
    }});
    try {
      expect((await legacy.query(`select private.student_assignment_release_v1($1,$2,clock_timestamp())->>'state' state`,[id(2),id(11)])).rows)
        .toEqual([{state:"open"}]);
      expect(await protectedFingerprint(legacy)).toBe(before);
    } finally { await legacy.close(); }
  },30_000);

  it.each(["exact", "expired", "different-reason", "missing-completion", "other-attention", "materialized", "held", "inactive"] as const)(
    "옛12시간 충돌만 한정 복구하고 재실행은 변경하지 않는다: %s", async (scenario) => {
      let before = "";
      let dates: unknown;
      let queueBefore: unknown;
      const legacy = await createFinalSchemaDatabase({beforeMigration: async (database,name) => {
        if (name !== waitRemovalMigration) return;
        await seed(database,false);
        await datedQueue("assigned",false,database);
        await database.query(`update private.vocab_assignment_series_items set
          effective_available_from=clock_timestamp()+interval '1 hour',
          effective_available_until=clock_timestamp()+interval '2 hours' where id=$1`, [id(51)]);
        await start(10,60,1,database);
        await answeredQuestion(database);
        await finishFirst(new Date().toISOString(),60,database);
        expect((await database.query("select status from private.vocab_assignment_series_items order by sequence_number")).rows)
          .toEqual([{status:"completed"},{status:"attention"}]);
        if (scenario === "expired") await database.query(`update private.vocab_assignment_series_items set
          effective_available_from=clock_timestamp()-interval '2 hours',effective_available_until=clock_timestamp()-interval '1 hour' where id=$1`,[id(51)]);
        if (scenario === "different-reason") await database.query(`update private.vocab_assignment_series_items set attention_reason='assignment_expired' where id=$1`,[id(51)]);
        if (scenario === "missing-completion") await database.query(`update private.vocab_assignment_series_items set completed_attempt_id=null where id=$1`,[id(50)]);
        if (scenario === "other-attention") await database.query(`update private.vocab_assignment_series_items set status='attention',completed_at=null,completed_attempt_id=null,attention_reason='assignment_expired' where id=$1`,[id(50)]);
        if (scenario === "materialized") await database.query(`update private.vocab_assignment_series_items set assignment_id=$1,materialized_at=clock_timestamp() where id=$2`,[id(11),id(51)]);
        if (scenario === "held") await database.query(`update private.vocab_assignment_series_items set status='deferred',completed_at=null,completed_attempt_id=null,deferred_at=clock_timestamp() where id=$1`,[id(50)]);
        if (scenario === "inactive") await database.query(`update students set status='blocked' where id=$1`,[id(2)]);
        dates = (await database.query(`select planned_available_from,planned_available_until,
          effective_available_from,effective_available_until from private.vocab_assignment_series_items order by id`)).rows;
        queueBefore = (await database.query(`select to_jsonb(i) value from private.vocab_assignment_series_items i order by id`)).rows;
        before = await protectedFingerprint(database);
      }});
      try {
        expect(await protectedFingerprint(legacy)).toBe(before);
        expect((await legacy.query(`select planned_available_from,planned_available_until,
          effective_available_from,effective_available_until from private.vocab_assignment_series_items order by id`)).rows).toEqual(dates);
        const repaired = scenario === "exact";
        expect((await legacy.query("select status from private.vocab_assignment_series_items where id=$1",[id(51)])).rows)
          .toEqual([{status:repaired ? "ready" : "attention"}]);
        expect((await legacy.query("select status from private.vocab_assignment_series")).rows)
          .toEqual([{status:repaired ? "active" : "attention"}]);
        if (!repaired) expect((await legacy.query(`select to_jsonb(i) value from private.vocab_assignment_series_items i order by id`)).rows).toEqual(queueBefore);
        const events = (await legacy.query<{details:Record<string,unknown>}>(`select details from private.vocab_assignment_series_events
          where details->>'reason'='predecessor_wait_removed'`)).rows;
        expect(events).toHaveLength(repaired ? 1 : 0);
        if (repaired) expect(events[0]!.details).toMatchObject({workOrder:"APP-20260907-04",scheduleShifted:false,previousAttemptId:id(60)});
        const firstRun = (await legacy.query(`select
          (select jsonb_agg(to_jsonb(i) order by id) from private.vocab_assignment_series_items i) items,
          (select jsonb_agg(to_jsonb(s) order by id) from private.vocab_assignment_series s) series,
          (select jsonb_agg(to_jsonb(e) order by id) from private.vocab_assignment_series_events e) events`)).rows;
        await legacy.exec(readFileSync(`supabase/migrations/${waitRemovalMigration}`,"utf8"));
        expect((await legacy.query(`select
          (select jsonb_agg(to_jsonb(i) order by id) from private.vocab_assignment_series_items i) items,
          (select jsonb_agg(to_jsonb(s) order by id) from private.vocab_assignment_series s) series,
          (select jsonb_agg(to_jsonb(e) order by id) from private.vocab_assignment_series_events e) events`)).rows).toEqual(firstRun);
      } finally { await legacy.close(); }
    },30_000,
  );

  it("복구 대상 ID는 최초 한 번 고정하고 모든 잠금·최종 조회가 그 범위를 유지한다", () => {
    const sql = readFileSync(`supabase/migrations/${waitRemovalMigration}`,"utf8");
    const repair = sql.slice(sql.indexOf("do $repair$"));
    expect(repair.match(/into candidate_series_ids, candidate_student_ids/gu)).toHaveLength(1);
    expect(repair.match(/series\.id = any\(candidate_series_ids\) and series\.student_id = any\(candidate_student_ids\)/gu)).toHaveLength(3);
    expect(repair).toContain("where student.id = any(candidate_student_ids)");
    expect(repair.match(/for update of (?:student|series|item) nowait/gu)).toHaveLength(3);
    expect(sql).not.toMatch(/\b(?:update|delete from|insert into)\s+public\./giu);
  });

  it("첫 완료 신호만 다음 회차를 한 번 준비하며 재시험·답·점수는 그대로 둔다", async () => {
    await datedQueue();
    // A valid previously edited window differs from the original plan.
    await db.query("update private.vocab_assignment_series_items set effective_available_from=effective_available_from+interval '30 minutes' where id=$1", [id(51)]);
    const datesBefore = (await db.query("select effective_available_from,effective_available_until from private.vocab_assignment_series_items where id=$1",[id(51)])).rows;
    await start();
    await finishFirst();
    expect((await items()).map(i=>i.status)).toEqual(["completed","ready"]);
    expect((await db.query("select effective_available_from,effective_available_until from private.vocab_assignment_series_items where id=$1",[id(51)])).rows).toEqual(datesBefore);
    const snapshot = (await db.query("select to_jsonb(a) value from quiz_attempts a order by id")).rows;
    await db.query("select private.advance_vocab_queue_first_attempt_v1($1)",[id(60)]);
    await db.query("select private.advance_vocab_queue_first_attempt_v1($1)",[id(60)]);
    expect((await db.query("select to_jsonb(a) value from quiz_attempts a order by id")).rows).toEqual(snapshot);
    expect((await db.query("select * from private.vocab_assignment_series_events where event_kind='session.ready'")).rows).toHaveLength(1);
    expect((await items())[0]!.completed_at).toEqual(
      (await db.query<{ initial_completed_at: Date }>("select initial_completed_at from quiz_attempts where id=$1",[id(60)])).rows[0]!.initial_completed_at);
  });

  it("건너뛴 회차를 보류로 남기고 다음 일정 충돌도 거래 실패로 되돌리지 않는다", async () => {
    await datedQueue("attention",true);
    await db.exec("set local role authenticated");
    const result = (await db.query<{ value: { resolution: { item_id: string } } }>(
      "select resolve_vocab_assignment_queue_attention_v3($1,'skip',$2) value",[id(41),id(50)])).rows[0]!.value;
    expect(result.resolution.item_id).toBe(id(50));
    await db.exec("reset role");
    expect((await items()).map(i=>i.status)).toEqual(["deferred","attention"]);
    expect((await items())[0]).toMatchObject({ completed_at:null, deferred_at:expect.any(Date) });
    expect((await gate(10)).state).toBe("held");
    await reject(() => db.query("select resolve_vocab_assignment_queue_attention_v3($1,'skip',$2)",[id(41),id(50)]),
      /vocab_queue_resolution_target_changed/u);
    expect((await items()).map(i=>i.status)).toEqual(["deferred","attention"]);
    await db.query("select resolve_vocab_assignment_queue_attention_v3($1,'skip',$2)",[id(41),id(51)]);
    expect((await db.query("select status,completed_at from private.vocab_assignment_series")).rows[0])
      .toEqual({status:"deferred",completed_at:null});
    const summary = (await db.query<{ value: Record<string,unknown> }>(
      "select to_jsonb(s) value from public.list_vocab_assignment_queue_summaries_v2(true,$1) s where series_id=$2",[id(2),id(41)])).rows[0]!.value;
    expect(summary).toMatchObject({remaining_session_count:0,completed_session_count:0,status:"deferred"});
  });

  it("보류 다음 회차의 자체 예약은 유지하고 정상 공개 뒤 마감은 미응시로 처리한다", async () => {
    await datedQueue("attention");
    await db.exec(`
      update private.vocab_assignment_series_items set status='deferred',deferred_at=clock_timestamp()-interval '3 days',attention_reason=null where id='${id(50)}';
      update private.vocab_assignment_series_items set status='assigned',assignment_id='${id(11)}',materialized_at=clock_timestamp() where id='${id(51)}';
      update assignments set available_from='2030-01-01T00:00:00Z',available_until='2030-01-02T00:00:00Z' where id='${id(11)}';
    `);
    expect((await gate(11,"2029-12-31T23:59:59Z")).state).toBe("waiting_time");
    expect((await gate(11,"2030-01-01T00:00:00Z")).state).toBe("open");
    await db.exec(`update assignments set available_from=clock_timestamp()-interval '2 days',
      available_until=clock_timestamp()-interval '1 day' where id='${id(11)}'`);
    expect((await gate()).state).toBe("open");
    await db.query("select public.finalize_missed_assignments($1,100)",[id(2)]);
    expect((await db.query<{missed_at:Date|null}>("select missed_at from assignment_students where assignment_id=$1",[id(11)])).rows[0]!.missed_at).toBeInstanceOf(Date);
  });

  it("열리지 못한 회차는 일정 확인으로 남기고 자동 날짜 이동·미응시 낙인을 만들지 않는다", async () => {
    await receipt();
    await db.exec(`update assignments set available_until=clock_timestamp()-interval '1 day' where id='${id(11)}'`);
    expect((await gate()).state).toBe("schedule_conflict");
    await db.query("select public.finalize_missed_assignments($1,100)",[id(2)]);
    expect((await db.query<{missed_at:Date|null}>("select missed_at from assignment_students where assignment_id=$1",[id(11)])).rows[0]!.missed_at).toBeNull();
    const dashboard = await db.query<{ dashboard_section: string }>("select * from private.student_dashboard_read_rows_v2($1,clock_timestamp()) where assignment_id=$2",[id(2),id(11)]);
    expect(dashboard.rows[0]!.dashboard_section).toBe("needs_attention");
  });

  it("이미 시작한 후속 시험은 보존하지만 재응시 INSERT까지 면제하지 않는다", async () => {
    await start(11,61);
    await receipt();
    expect((await gate()).state).toBe("waiting_initial");
    await db.query("update quiz_attempts set current_question_started_at=clock_timestamp() where id=$1",[id(61)]);
    await reject(() => start(11,62,2), /assignment_release_waiting_initial/u);
    expect((await db.query("select id,status,phase from quiz_attempts")).rows).toEqual([{id:id(61),status:"in_progress",phase:"initial"}]);
  });

  it("보류가 후속의 명시적 취소를 해제하지 않고 구형 skip RPC는 거절한다", async () => {
    await datedQueue("attention");
    await db.exec(`
      update private.vocab_assignment_series_items set status='deferred',deferred_at=clock_timestamp(),attention_reason=null where id='${id(50)}';
      update private.vocab_assignment_series_items set status='cancelled',assignment_id='${id(11)}',
        materialized_at=clock_timestamp(),cancelled_at=clock_timestamp() where id='${id(51)}';
      update private.vocab_assignment_series set status='cancelled',cancelled_at=clock_timestamp(),attention_reason=null where id='${id(41)}';
    `);
    expect((await gate()).state).toBe("cancelled");
    await reject(() => start(11),/assignment_release_cancelled/u);
    await db.exec("set local role authenticated");
    for(const version of [1,2]) await reject(() => db.query(
      `select resolve_vocab_assignment_queue_attention_v${version}($1,'skip')`,[id(41)]),/permission denied/u);
    await db.exec("reset role");
    expect((await db.query<{ dashboard_section:string }>("select dashboard_section from private.student_dashboard_read_rows_v2($1,clock_timestamp()) where assignment_id=$2",[id(2),id(11)])).rows[0]!.dashboard_section).toBe("deadline_closed");
  });

  it("구 목록 v1은 유지하고 v2만 새 공개 상태를 전달하며 두 공개 조회의 권한을 보존한다", async () => {
    await receipt();
    // Match Supabase's trusted server role in this rolled-back fixture only.
    // anon/authenticated retain the production grants and RLS restrictions.
    await db.exec("alter role service_role bypassrls");
    await db.exec("set local role service_role");
    const oldRow = studentDashboardInitialRowSchema.parse((await db.query<{ value: unknown }>(
      "select to_jsonb(r) value from public.get_student_dashboard_initial_v1($1,null) r", [id(2)],
    )).rows[0]!.value);
    const newRow = studentDashboardInitialRowSchema.parse((await db.query<{ value: unknown }>(
      "select to_jsonb(r) value from public.get_student_dashboard_initial_v2($1,null) r", [id(2)],
    )).rows[0]!.value);
    const oldNext = oldRow.current_items.find(item => item.assignmentId === id(11))!;
    const newNext = newRow.current_items.find(item => item.assignmentId === id(11))!;
    expect(oldNext.dashboardSection).toBe("open");
    expect(oldNext.item.release).toBeUndefined();
    expect(newNext.dashboardSection).toBe("scheduled");
    expect(newNext.item.release?.state).toBe("waiting_initial");
    expect(newRow.open_count).toBe(5);
    expect(newRow.scheduled_count).toBe(2);
    for (const version of [1, 2]) {
      expect((await db.query(`select * from public.list_student_dashboard_completed_page_v${version}(
        $1,statement_timestamp(),statement_timestamp(),$2)`, [id(2),id(11)])).rows).toEqual([]);
    }
    await db.exec("reset role");
    const signatures = [
      "private.student_assignment_release_v1(uuid,uuid,timestamptz)",
      "private.student_dashboard_read_rows_v2(uuid,timestamptz)",
      "public.get_student_dashboard_initial_v2(uuid,timestamptz)",
      "public.list_student_dashboard_completed_page_v2(uuid,timestamptz,timestamptz,uuid)",
    ];
    for (const signature of signatures) {
      expect((await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`select
        has_function_privilege('anon',$1,'execute') anon,
        has_function_privilege('authenticated',$1,'execute') authenticated,
        has_function_privilege('service_role',$1,'execute') service`,[signature])).rows[0])
        .toEqual({anon:false,authenticated:false,service:true});
    }
    expect((await db.query(`select
      has_function_privilege('anon','private.ready_next_vocab_assignment_item_v1(uuid,integer,timestamptz)','execute') anon,
      has_function_privilege('authenticated','private.ready_next_vocab_assignment_item_v1(uuid,integer,timestamptz)','execute') authenticated,
      has_function_privilege('service_role','private.ready_next_vocab_assignment_item_v1(uuid,integer,timestamptz)','execute') service`)).rows)
      .toEqual([{anon:false,authenticated:false,service:false}]);
    await reject(() => start(11), /assignment_release_waiting_initial/u);
  });
});
