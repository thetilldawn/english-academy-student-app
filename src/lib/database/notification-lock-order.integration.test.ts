import fs from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

let db: Awaited<ReturnType<typeof createFinalSchemaDatabase>>;
const current = "supabase/migrations/20261003235930_order_student_notification_locks.sql";
const previous = "supabase/migrations/20260929054833_gate_student_notifications_on_assignment_release.sql";
const migrationBody = (file: string) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
const id = (n: number) => `b7120000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeAll(async () => { db = await createFinalSchemaDatabase(); }, 120_000);
afterAll(async () => { await db?.close(); });

it("원래 함수와 기존 수신 이력을 보존하며 교체하고 재적용해도 같은 결과다", async () => {
  await db.exec("begin;");
  try {
    await db.exec(migrationBody(previous));
    await db.exec(`
      insert into auth.users(id) values('${id(1)}');
      insert into public.admin_profiles(user_id,display_name,is_active) values('${id(1)}','가짜 관리자',true);
      insert into public.students(id,display_name,status,created_by) values('${id(2)}','가짜 학생','active','${id(1)}');
      insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${id(4)}','app12-fake','가짜 검사','가상',repeat('A',64),4,'ready','${id(1)}');
      insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,passing_score,status,created_by,retake_allowed)
        values('${id(10)}','가짜 배정','${id(4)}',1,4,4,300,80,'active','${id(1)}',true);
      insert into public.notification_receipts(viewer_role,viewer_id,notification_type,assignment_id,student_id,deadline_version)
        values('student','${id(2)}','new_assignment','${id(10)}','${id(2)}','-infinity');
    `);
    const records = () => db.query(`select jsonb_build_object(
      'students',(select jsonb_agg(to_jsonb(t) order by id) from public.students t),
      'receipts',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.notification_receipts t),
      'assignments',(select jsonb_agg(to_jsonb(t) order by id) from public.assignments t)) value`);
    const others = () => db.query(`select to_jsonb(p) value from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace)
      and oid<>'public.claim_student_notifications_v1(uuid)'::regprocedure order by oid`);
    const meta = () => db.query(`select to_jsonb(p)-'prosrc'-'prolang' value from pg_proc p where oid='public.claim_student_notifications_v1(uuid)'::regprocedure`);
    const before = { records: await records(), others: await others(), meta: await meta() };
    await db.exec(migrationBody(current));
    expect(await records()).toEqual(before.records);
    expect(await others()).toEqual(before.others);
    expect(await meta()).toEqual(before.meta);
    expect((await db.query("select l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='public.claim_student_notifications_v1(uuid)'::regprocedure")).rows).toEqual([{ lanname: "plpgsql" }]);
    const after = await db.query("select pg_get_functiondef('public.claim_student_notifications_v1(uuid)'::regprocedure) value");
    // The migration's temporary guard table is transaction-local in a real rollout.
    await db.exec("drop table app12_notification_meta;");
    await db.exec(migrationBody(current));
    expect(await db.query("select pg_get_functiondef('public.claim_student_notifications_v1(uuid)'::regprocedure) value")).toEqual(after);
    expect(await records()).toEqual(before.records);
    expect(await others()).toEqual(before.others);
  } finally {
    await db.exec("rollback;");
  }
}, 30_000);
