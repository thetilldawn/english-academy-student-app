import {beforeAll,afterAll,beforeEach,afterEach,expect,it} from "vitest";
import {createFinalSchemaDatabase} from "@/test-support/final-schema-database";
let db:Awaited<ReturnType<typeof createFinalSchemaDatabase>>;
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
beforeAll(async()=>{db=await createFinalSchemaDatabase();},120000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec(`begin;
select set_config('request.jwt.claim.sub','${id(1)}',true);select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into auth.users(id) values('${id(1)}');
insert into admin_profiles(user_id,display_name,is_active) values('${id(1)}','가짜 관리자',true);
insert into students(id,display_name,status,created_by) values('${id(2)}','가짜 학생','active','${id(1)}');
insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by) values('${id(4)}','audit-notification','가짜 검사','가상',repeat('A',64),4,'ready','${id(1)}');
insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values('${id(100)}','${id(4)}','DAY 1','day 1','day',1,1,4);
insert into assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,passing_score,status,created_by,retake_allowed) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n::text||'회차','${id(4)}',1,4,4,300,80,'active','${id(1)}',true from generate_series(10,11)n;
insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) select id,'${id(4)}','${id(100)}',1,true from assignments;
insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) select id,'${id(2)}','${id(1)}',clock_timestamp()-interval '10 days' from assignments;`);
const receipt=[10,11].map((n,i)=>({student_id:id(2),assignment_id:id(n),session_number:i+1}));
await db.query(`insert into private.bulk_vocab_series_requests(idempotency_key,request_sha256,payload_sha256,actor_admin_id,result,completed_at) values($1,repeat('a',64),repeat('b',64),$2,$3,clock_timestamp())`,[id(40),id(1),JSON.stringify(receipt)]);
});
afterEach(async()=>{await db.exec("rollback;");});
beforeEach(async () => { await db.query("update assignments set available_until=clock_timestamp()+interval '2 hours' where id=$1", [id(11)]); });


type Counts = { new_assignment_count: number; deadline_soon_count: number };
async function claim(student = id(2)) {
  return (await db.query<Counts>("select * from public.claim_student_notifications_v1($1)", [student])).rows[0]!;
}
async function state(assignment = id(11)) {
  return (await db.query<{ value: { state: string } }>("select private.student_assignment_release_v1($1,$2,clock_timestamp()) value", [id(2), assignment])).rows[0]!.value.state;
}
async function completeFirst() {
  await db.query(`insert into quiz_attempts(id,student_id,assignment_id,attempt_number,deadline_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
    values($1,$2,$3,1,clock_timestamp()+interval '2 hours',4,300,80,'initial')`, [id(60), id(2), id(10)]);
  await db.query(`update quiz_attempts set phase='review',initial_completed_at=clock_timestamp(),initial_correct_count=2,retry_correct_count=0,unresolved_wrong_count=2,initial_score=50,elapsed_seconds=1 where id=$1`, [id(60)]);
}
async function studentReceipts(assignment = id(11)) {
  return (await db.query("select notification_type,deadline_version from notification_receipts where viewer_role='student' and assignment_id=$1", [assignment])).rows;
}
async function privateSnapshot() {
  const tables = ["students", "assignments", "assignment_students", "quiz_attempts", "student_point_events"];
  return Promise.all(tables.map(async table => (await db.query(`select to_jsonb(t) value from public.${table} t order by to_jsonb(t)::text`)).rows));
}
async function queueState(status: "deferred" | "cancelled" | "assigned", sequence = 1) {
  await db.query(`insert into private.vocab_assignment_queue_requests(idempotency_key,request_sha256,payload_sha256,actor_admin_id) values($1,repeat('a',64),repeat('b',64),$2)`, [id(70), id(1)]);
  await db.query(`insert into private.vocab_assignment_series(id,request_id,student_id,dataset_id,actor_admin_id,dataset_label,range_label,recurrence_slots)
    values($1,$2,$3,$4,$5,'가짜','1','[{"isodow":1,"local_time":"09:00","duration_seconds":3600}]')`, [id(71), id(70), id(2), id(4), id(1)]);
  await db.query(`insert into private.vocab_assignment_series_items(id,series_id,sequence_number,status,question_count,unit_ids,unit_labels,planned_available_from,planned_available_until,effective_available_from,effective_available_until,payload,assignment_id,materialized_at)
    values($1,$2,$3,'assigned',4,array[$4::uuid],array['1'],clock_timestamp()-interval '1 day',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '1 day',clock_timestamp()+interval '2 hours','{"retry_enabled":true,"retry_passing_score":80,"passing_score":80}',$5,clock_timestamp())`,
    [id(72), id(71), sequence, id(100), id(11)]);
  if (status === "deferred") await db.query("update private.vocab_assignment_series_items set status='deferred',deferred_at=clock_timestamp() where id=$1", [id(72)]);
  if (status === "cancelled") await db.query("update private.vocab_assignment_series_items set status='cancelled',cancelled_at=clock_timestamp() where id=$1", [id(72)]);
}
it("앞 시험 미완료 중에는 후속 신규·마감 알림을 소비하지 않는다", async () => {
  expect(await state()).toBe("waiting_initial");
  const snapshot = await privateSnapshot();
  expect(await claim()).toEqual({ new_assignment_count: 1, deadline_soon_count: 0 });
  expect(await studentReceipts()).toEqual([]);
  expect(await privateSnapshot()).toEqual(snapshot);
});
it("앞 최초 시험 완료·복습 중이면 후속 공개 뒤 각1회만 수령한다", async () => {
  await claim(); await completeFirst(); expect(await state()).toBe("open");
  const snapshot = await privateSnapshot();
  expect(await claim()).toEqual({ new_assignment_count: 1, deadline_soon_count: 1 });
  expect(await claim()).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
  expect(await studentReceipts()).toHaveLength(2);
  expect(await privateSnapshot()).toEqual(snapshot);
});
it("후속 시험 자체 시작일도 기다리고 날짜가 없으면 공개 뒤 신규만 알린다", async () => {
  await claim(); await completeFirst();
  await db.query("update assignments set available_from=clock_timestamp()+interval '1 hour' where id=$1", [id(11)]);
  expect(await state()).toBe("waiting_time");
  expect(await claim()).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
  await db.query("update assignments set available_from=null,available_until=null where id=$1", [id(11)]);
  expect(await claim()).toEqual({ new_assignment_count: 1, deadline_soon_count: 0 });
});
it.each([["deferred", "held"], ["cancelled", "cancelled"], ["assigned", "schedule_conflict"]] as const)(
  "큐 %s 상태도 두 알림을 막는다", async (status, expected) => {
    await claim(); await queueState(status, status === "assigned" ? 2 : 1);
    expect(await state()).toBe(expected);
    expect(await claim()).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
    expect(await studentReceipts()).toEqual([]);
  });
it("배정 시각 전에는 unavailable로 수령하지 않는다", async () => {
  await claim(); await completeFirst();
  await db.query("update assignment_students set assigned_at=clock_timestamp()+interval '1 day' where assignment_id=$1", [id(11)]);
  expect(await state()).toBe("unavailable");
  expect(await claim()).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
});
it("첫 회차 unrestricted라도 자체 미래 시작일을 지킨다", async () => {
  await db.query("update assignments set available_from=clock_timestamp()+interval '1 hour',available_until=clock_timestamp()+interval '2 hours' where id=$1", [id(10)]);
  expect(await state(id(10))).toBe("unrestricted");
  expect(await claim()).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
  await db.query("update assignments set available_from=clock_timestamp()-interval '1 hour' where id=$1", [id(10)]);
  expect(await claim()).toEqual({ new_assignment_count: 1, deadline_soon_count: 1 });
});
it.each(["cancelled", "missed", "deleted", "closed", "attempt"] as const)("기존 %s 제외 조건을 유지한다", async condition => {
  await claim(); await completeFirst();
  if (condition === "cancelled") await db.query("update assignment_students set cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='가짜 취소' where assignment_id=$1", [id(11), id(1)]);
  if (condition === "missed") await db.query("update assignment_students set missed_at=clock_timestamp() where assignment_id=$1", [id(11)]);
  if (condition === "deleted") await db.query("update assignments set deleted_at=clock_timestamp(),deleted_by=$2,deletion_reason='가짜 삭제',status='closed' where id=$1", [id(11), id(1)]);
  if (condition === "closed") await db.query("update assignments set status='closed' where id=$1", [id(11)]);
  if (condition === "attempt") await db.query(`insert into quiz_attempts(id,student_id,assignment_id,attempt_number,deadline_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
    values($1,$2,$3,1,clock_timestamp()+interval '1 hour',4,300,80,'initial')`, [id(61), id(2), id(11)]);
  expect(await claim()).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
  expect(await studentReceipts()).toEqual([]);
});
it.each([7, 9, -1])("마감 %i시간: 기존8시간 범위와 새로운 마감 버전만 알린다", async hours => {
  await claim(); await completeFirst();
  await db.query("update assignments set available_until=clock_timestamp()+$2*interval '1 hour' where id=$1", [id(11), hours]);
  const result = await claim();
  // A past deadline also precedes the release opening and is schedule_conflict.
  expect(result).toEqual({ new_assignment_count: hours < 0 ? 0 : 1, deadline_soon_count: hours === 7 ? 1 : 0 });
  await db.query("update assignments set available_until=clock_timestamp()+interval '3 hours' where id=$1", [id(11)]);
  expect(await claim()).toEqual({ new_assignment_count: hours < 0 ? 1 : 0, deadline_soon_count: 1 });
  expect(await claim()).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
});
it("다른 학생 조회는 수령하지 않고 권한·함수 설정을 유지한다", async () => {
  expect(await claim(id(999))).toEqual({ new_assignment_count: 0, deadline_soon_count: 0 });
  const meta = (await db.query<{ prosecdef: boolean; proconfig: string[] }>("select prosecdef,proconfig from pg_proc where oid='public.claim_student_notifications_v1(uuid)'::regprocedure")).rows[0]!;
  expect(meta).toEqual({ prosecdef: false, proconfig: ['search_path=""'] });
  const rls = (await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.notification_receipts'::regclass")).rows[0]!;
  expect(rls.relrowsecurity).toBe(true);
  for (const role of ["anon", "authenticated"]) {
    await db.exec("savepoint denied_role");
    await db.exec("set local role " + role);
    await expect(claim()).rejects.toThrow(/permission denied/);
    await db.exec("rollback to denied_role; release denied_role");
  }
  await db.exec("alter role service_role bypassrls; set local role service_role");
  expect(await claim()).toEqual({ new_assignment_count: 1, deadline_soon_count: 0 });
  await db.exec("reset role");
});
