import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260831101000_add_student_profile_version_command.sql",
  ),
  "utf8",
);
const studentId = "00000000-0000-4000-8000-000000000001";

describe("student profile optimistic command SQL", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;
      create schema auth;
      create function private.is_active_admin()
      returns boolean language sql stable as $$ select true $$;
      create function auth.uid()
      returns uuid language sql stable as $$
        select '00000000-0000-4000-8000-000000000099'::uuid
      $$;
      create table public.students (
        id uuid primary key,
        display_name text not null,
        school_name text,
        grade_label text,
        updated_at timestamptz not null default clock_timestamp(),
        deleted_at timestamptz
      );
      create table public.audit_events (
        event_type text not null,
        actor_admin_id uuid,
        student_id uuid,
        details jsonb
      );
      create function public.get_admin_student_detail_initial_v1(
        p_student_id uuid,
        p_snapshot_at timestamptz default null
      ) returns jsonb language sql stable as $$
        select jsonb_build_object(
          'snapshotAt', coalesce(p_snapshot_at, statement_timestamp()),
          'student', jsonb_build_object(
            'id', student.id,
            'displayName', student.display_name,
            'schoolName', student.school_name,
            'gradeLabel', student.grade_label
          )
        )
        from public.students as student
        where student.id = p_student_id and student.deleted_at is null
      $$;
      insert into public.students (
        id, display_name, school_name, grade_label, updated_at
      ) values (
        '${studentId}', '학생 A', '미리보기고', '고3',
        '2026-08-31T00:00:00.000Z'
      );
    `);
    await database.exec(migration);
  });

  afterAll(async () => database?.close());

  it("rejects a reused base version and keeps versions monotonic", async () => {
    const firstProfile = await database.query<{ profile: { updatedAt: string } }>(`
      select public.get_admin_student_profile_v1('${studentId}') as profile
    `);
    const baseVersion = firstProfile.rows[0]!.profile.updatedAt;
    const first = await database.query<{
      advanced: boolean;
      receipt: { updatedAt: string };
    }>(`
      with result as (
        select public.update_admin_student_profile_v1(
          '${studentId}', '${baseVersion}', '학생 B', '미리보기고', '고3'
        ) as receipt
      )
      select receipt,
        (receipt ->> 'updatedAt')::timestamptz > '${baseVersion}'::timestamptz
          as advanced
      from result
    `);
    const firstVersion = first.rows[0]!.receipt.updatedAt;
    expect(first.rows[0]!.advanced).toBe(true);

    await expect(database.query(`
      select public.update_admin_student_profile_v1(
        '${studentId}', '${baseVersion}', '충돌', '미리보기고', '고3'
      )
    `)).rejects.toThrow(/student_profile_conflict/u);

    const second = await database.query<{
      advanced: boolean;
      receipt: { updatedAt: string };
    }>(`
      with result as (
        select public.update_admin_student_profile_v1(
          '${studentId}', '${firstVersion}', '학생 C', '미리보기고', '고3'
        ) as receipt
      )
      select receipt,
        (receipt ->> 'updatedAt')::timestamptz > '${firstVersion}'::timestamptz
          as advanced
      from result
    `);
    expect(second.rows[0]!.advanced).toBe(true);
    const audit = await database.query<{ count: string }>(`
      select count(*)::text as count from public.audit_events
    `);
    expect(audit.rows[0]!.count).toBe("2");
  });

  it("returns the profile version in the one-call detail model", async () => {
    const result = await database.query<{
      detail: { student: { id: string; updatedAt: string } };
      profile: { updatedAt: string };
    }>(`
      select
        public.get_admin_student_detail_initial_v2('${studentId}', null) as detail,
        public.get_admin_student_profile_v1('${studentId}') as profile
    `);
    expect(result.rows[0]!.detail.student).toMatchObject({ id: studentId });
    expect(result.rows[0]!.detail.student.updatedAt).toBe(
      result.rows[0]!.profile.updatedAt,
    );
  });

  it("rolls back the profile update when the audit insert fails", async () => {
    await database.exec(`
      delete from public.audit_events;
      alter table public.audit_events add constraint reject_profile_audit
        check (event_type <> 'student.profile_updated');
    `);
    const before = await database.query<{ profile: { displayName: string; updatedAt: string } }>(`
      select public.get_admin_student_profile_v1('${studentId}') as profile
    `);
    await expect(database.query(`
      select public.update_admin_student_profile_v1(
        '${studentId}', '${before.rows[0]!.profile.updatedAt}',
        '롤백되어야 함', '미리보기고', '고3'
      )
    `)).rejects.toThrow(/reject_profile_audit/u);
    const after = await database.query<{ profile: { displayName: string; updatedAt: string } }>(`
      select public.get_admin_student_profile_v1('${studentId}') as profile
    `);
    expect(after.rows[0]!.profile).toStrictEqual(before.rows[0]!.profile);
  });
});
