import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730223000_persist_missed_assignments.sql",
  ),
  "utf8",
);

const ids = {
  student1: "00000000-0000-4000-8000-000000000001",
  student2: "00000000-0000-4000-8000-000000000002",
  dueBackfill: "00000000-0000-4000-8000-000000000101",
  attemptedBackfill: "00000000-0000-4000-8000-000000000102",
  future: "00000000-0000-4000-8000-000000000103",
  dueTargeted: "00000000-0000-4000-8000-000000000104",
  dueOtherStudent: "00000000-0000-4000-8000-000000000105",
  attemptedAfterMigration:
    "00000000-0000-4000-8000-000000000106",
} as const;

async function expectPostgresError(
  operation: Promise<unknown>,
  code: string,
  messageFragment: string,
) {
  try {
    await operation;
    throw new Error("expected PostgreSQL operation to fail");
  } catch (error) {
    expect(error).toMatchObject({ code });
    expect((error as Error).message).toContain(messageFragment);
  }
}

describe.sequential("missed assignment finalization", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create table public.students (
        id uuid primary key
      );
      create table public.assignments (
        id uuid primary key,
        available_until timestamptz
      );
      create table public.assignment_students (
        assignment_id uuid not null,
        student_id uuid not null
          constraint assignment_students_student_id_fkey
          references public.students(id)
          on delete cascade,
        assigned_at timestamptz not null default clock_timestamp(),
        primary key (assignment_id, student_id)
      );
      create table public.quiz_attempts (
        id uuid primary key,
        student_id uuid not null,
        assignment_id uuid not null
      );
      create table public.audit_events (
        event_type text not null,
        student_id uuid,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default clock_timestamp()
      );

      grant usage on schema public to service_role;
      grant select, update on public.students to service_role;
      grant select on public.assignments to service_role;
      grant select, update on public.assignment_students to service_role;
      grant select on public.quiz_attempts to service_role;
      grant insert on public.audit_events to service_role;

      insert into public.students (id)
      values ('${ids.student1}'), ('${ids.student2}');

      insert into public.assignments (id, available_until)
      values
        (
          '${ids.dueBackfill}',
          clock_timestamp() - interval '1 day'
        ),
        (
          '${ids.attemptedBackfill}',
          clock_timestamp() - interval '1 day'
        ),
        (
          '${ids.future}',
          clock_timestamp() + interval '1 day'
        );

      insert into public.assignment_students (
        assignment_id,
        student_id,
        assigned_at
      )
      values
        (
          '${ids.dueBackfill}',
          '${ids.student1}',
          clock_timestamp() - interval '2 days'
        ),
        (
          '${ids.attemptedBackfill}',
          '${ids.student1}',
          clock_timestamp() - interval '2 days'
        ),
        (
          '${ids.future}',
          '${ids.student1}',
          clock_timestamp() - interval '2 days'
        );

      insert into public.quiz_attempts (
        id,
        student_id,
        assignment_id
      )
      values (
        '00000000-0000-4000-8000-000000000201',
        '${ids.student1}',
        '${ids.attemptedBackfill}'
      );
    `);
    await database.exec(migration);
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  it("기존 마감 배정도 제한된 함수 호출에서만 확정한다", async () => {
    const before = await database.query<{ missed: number }>(`
      select count(*) filter (
        where missed_at is not null
      )::integer as missed
      from public.assignment_students;
    `);
    expect(before.rows[0]?.missed).toBe(0);

    await database.exec("set role service_role;");
    const finalized = await database.query<{ count: number }>(`
      select public.finalize_missed_assignments(
        '${ids.student1}',
        100
      ) as count;
    `);
    await database.exec("reset role;");
    expect(finalized.rows[0]?.count).toBe(1);

    const state = await database.query<{
      assignment_id: string;
      missed: boolean;
    }>(`
      select
        assignment_id::text,
        missed_at is not null as missed
      from public.assignment_students
      order by assignment_id;
    `);

    expect(state.rows).toEqual([
      { assignment_id: ids.dueBackfill, missed: true },
      { assignment_id: ids.attemptedBackfill, missed: false },
      { assignment_id: ids.future, missed: false },
    ]);

    const audits = await database.query<{
      event_type: string;
      assignment_id: string;
    }>(`
      select
        event_type,
        details ->> 'assignment_id' as assignment_id
      from public.audit_events;
    `);
    expect(audits.rows).toEqual([
      {
        event_type: "assignment.missed",
        assignment_id: ids.dueBackfill,
      },
    ]);
  });

  it("익명·인증 사용자는 확정 함수를 실행할 수 없다", async () => {
    const privileges = await database.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.finalize_missed_assignments(uuid,integer)',
          'execute'
        ) as anon,
        has_function_privilege(
          'authenticated',
          'public.finalize_missed_assignments(uuid,integer)',
          'execute'
        ) as authenticated,
        has_function_privilege(
          'service_role',
          'public.finalize_missed_assignments(uuid,integer)',
          'execute'
        ) as service;
    `);

    expect(privileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service: true,
    });
  });

  it("학생별 확정은 다른 학생을 건드리지 않고 재실행해도 중복되지 않는다", async () => {
    await database.exec(`
      insert into public.assignments (id, available_until)
      values
        (
          '${ids.dueTargeted}',
          clock_timestamp() - interval '1 hour'
        ),
        (
          '${ids.dueOtherStudent}',
          clock_timestamp() - interval '1 hour'
        );
      insert into public.assignment_students (
        assignment_id,
        student_id,
        assigned_at
      )
      values
        (
          '${ids.dueTargeted}',
          '${ids.student1}',
          clock_timestamp() - interval '1 day'
        ),
        (
          '${ids.dueOtherStudent}',
          '${ids.student2}',
          clock_timestamp() - interval '1 day'
        );
      set role service_role;
    `);

    const first = await database.query<{ count: number }>(`
      select public.finalize_missed_assignments(
        '${ids.student1}',
        100
      ) as count;
    `);
    const second = await database.query<{ count: number }>(`
      select public.finalize_missed_assignments(
        '${ids.student1}',
        100
      ) as count;
    `);
    await database.exec("reset role;");

    expect(first.rows[0]?.count).toBe(1);
    expect(second.rows[0]?.count).toBe(0);

    const state = await database.query<{
      assignment_id: string;
      missed: boolean;
    }>(`
      select
        assignment_id::text,
        missed_at is not null as missed
      from public.assignment_students
      where assignment_id in (
        '${ids.dueTargeted}',
        '${ids.dueOtherStudent}'
      )
      order by assignment_id;
    `);
    expect(state.rows).toEqual([
      { assignment_id: ids.dueTargeted, missed: true },
      { assignment_id: ids.dueOtherStudent, missed: false },
    ]);
  });

  it("미응시 확정 뒤 새 시도는 차단하고 기존 시도는 보존한다", async () => {
    await expectPostgresError(
      database.query(`
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id
        )
        values (
          '00000000-0000-4000-8000-000000000202',
          '${ids.student1}',
          '${ids.dueTargeted}'
        );
      `),
      "22023",
      "assignment_already_missed",
    );
    await expectPostgresError(
      database.query(`
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id
        )
        values (
          '00000000-0000-4000-8000-000000000205',
          '${ids.student2}',
          '${ids.dueOtherStudent}'
        );
      `),
      "22023",
      "assignment_unavailable",
    );

    await database.exec(`
      insert into public.assignments (id, available_until)
      values (
        '${ids.attemptedAfterMigration}',
        clock_timestamp() + interval '1 hour'
      );
      insert into public.assignment_students (
        assignment_id,
        student_id,
        assigned_at
      )
      values (
        '${ids.attemptedAfterMigration}',
        '${ids.student2}',
        clock_timestamp() - interval '1 day'
      );
      insert into public.quiz_attempts (
        id,
        student_id,
        assignment_id
      )
      values (
        '00000000-0000-4000-8000-000000000203',
        '${ids.student2}',
        '${ids.attemptedAfterMigration}'
      );
      update public.assignments
      set available_until = clock_timestamp() - interval '1 hour'
      where id = '${ids.attemptedAfterMigration}';
      set role service_role;
    `);
    const finalized = await database.query<{ count: number }>(`
      select public.finalize_missed_assignments(null, 100) as count;
    `);
    await database.exec("reset role;");

    expect(finalized.rows[0]?.count).toBe(1);
    const attemptedState = await database.query<{
      missed: boolean;
    }>(`
      select missed_at is not null as missed
      from public.assignment_students
      where assignment_id = '${ids.attemptedAfterMigration}'
        and student_id = '${ids.student2}';
    `);
    expect(attemptedState.rows[0]?.missed).toBe(false);
  });

  it("배정되지 않은 시도와 이력이 있는 연결 삭제를 차단한다", async () => {
    await expectPostgresError(
      database.query(`
        insert into public.quiz_attempts (
          id,
          student_id,
          assignment_id
        )
        values (
          '00000000-0000-4000-8000-000000000204',
          '${ids.student2}',
          '${ids.dueTargeted}'
        );
      `),
      "42501",
      "assignment_not_owned",
    );

    await expectPostgresError(
      database.query(`
        delete from public.assignment_students
        where assignment_id = '${ids.dueTargeted}'
          and student_id = '${ids.student1}';
      `),
      "23503",
      "assignment_student_history_exists",
    );
    await expectPostgresError(
      database.query(`
        delete from public.assignment_students
        where assignment_id = '${ids.attemptedAfterMigration}'
          and student_id = '${ids.student2}';
      `),
      "23503",
      "assignment_student_history_exists",
    );

    const removed = await database.query<{ assignment_id: string }>(`
      delete from public.assignment_students
      where assignment_id = '${ids.future}'
        and student_id = '${ids.student1}'
      returning assignment_id::text;
    `);
    expect(removed.rows).toEqual([
      { assignment_id: ids.future },
    ]);
  });

  it("배치 크기 범위를 검증한다", async () => {
    await database.exec("set role service_role;");
    await expectPostgresError(
      database.query(
        "select public.finalize_missed_assignments(null, 0);",
      ),
      "22023",
      "invalid_finalize_limit",
    );
    await database.exec("reset role;");
  });
});
