import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829190000_add_student_dashboard_read_model.sql",
  ),
  "utf8",
);

const studentId = "00000000-0000-4000-8000-000000000001";
const datasetId = "00000000-0000-4000-8000-000000000002";
const unitId = "00000000-0000-4000-8000-000000000003";
const snapshotAt = "2026-08-29T00:00:00.000Z";

type InitialRow = {
  completed_count: string;
  completed_items: Array<{
    assignmentId: string;
    effectiveAt: string;
    item: { passingScore: number; questionCount: number };
  }>;
  current_items: Array<{
    assignmentId: string;
    dashboardSection: string;
    item: Record<string, unknown>;
  }>;
  deadline_closed_count: string;
  needs_attention_count: string;
  open_count: string;
  scheduled_count: string;
  snapshot_at: Date;
};

type PageRow = {
  cursor_assignment_id: string;
  cursor_effective_at: string;
};

function assignmentId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("student dashboard read model SQL", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create table public.vocab_datasets (
        id uuid primary key,
        title text not null,
        edition text
      );
      create table public.vocab_dataset_catalog (
        dataset_id uuid primary key,
        display_name text not null,
        catalog_group text not null,
        material_kind text not null,
        grade_code text,
        publisher text,
        series_title text,
        academic_year integer,
        curriculum_revision text,
        edition_label text,
        is_assignable boolean not null,
        sort_index integer not null
      );
      create table public.vocab_units (
        id uuid primary key,
        unit_label text not null,
        sort_index integer not null
      );
      create table public.assignments (
        id uuid primary key,
        title text not null,
        status text not null,
        assignment_purpose text not null,
        dataset_id uuid not null,
        range_start integer not null,
        range_end integer not null,
        question_count integer not null,
        timing_mode text not null,
        passing_score integer not null,
        retake_allowed boolean not null,
        available_from timestamptz,
        available_until timestamptz,
        deleted_at timestamptz
      );
      create table public.assignment_students (
        student_id uuid not null,
        assignment_id uuid not null,
        assigned_at timestamptz not null,
        missed_at timestamptz,
        cancelled_at timestamptz,
        primary key (student_id, assignment_id)
      );
      create table public.assignment_units (
        assignment_id uuid not null,
        unit_id uuid not null,
        position integer not null,
        is_primary boolean not null,
        primary key (assignment_id, unit_id)
      );
      create table public.quiz_attempts (
        id uuid primary key,
        student_id uuid not null,
        assignment_id uuid not null,
        attempt_number integer not null,
        status text not null,
        phase text not null,
        started_at timestamptz not null,
        initial_completed_at timestamptz,
        retry_started_at timestamptz,
        deadline_at timestamptz,
        completed_at timestamptz,
        question_count_snapshot integer not null,
        passing_score_snapshot integer not null,
        retry_passing_score_snapshot integer,
        unresolved_wrong_count integer,
        initial_score numeric,
        final_score numeric,
        passed boolean
      );

      insert into public.vocab_datasets values (
        '${datasetId}', '원본 단어장', null
      );
      insert into public.vocab_dataset_catalog values (
        '${datasetId}', '고3 모의고사', 'high_mock', 'exam_collection',
        'G12', null, null, 2025, null, null, true, 1
      );
      insert into public.vocab_units values (
        '${unitId}', '3월 19번', 19
      );
    `);
    await database.exec(migration);
    await database.exec(`
      insert into public.assignments (
        id, title, status, assignment_purpose, dataset_id,
        range_start, range_end, question_count, timing_mode,
        passing_score, retake_allowed, available_from, available_until
      )
      select
        ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        '고3 모의고사 · 3월 19번', 'active', 'regular', '${datasetId}',
        1, 20, 99, 'total', 99, true, null, null
      from generate_series(1, 33) as series(i);

      insert into public.assignment_students (
        student_id, assignment_id, assigned_at
      )
      select
        '${studentId}',
        ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        '2026-08-01T00:00:00.000Z'
      from generate_series(1, 33) as series(i);

      insert into public.assignment_units (
        assignment_id, unit_id, position, is_primary
      )
      select
        ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        '${unitId}', 1, true
      from generate_series(1, 33) as series(i);

      insert into public.quiz_attempts (
        id, student_id, assignment_id, attempt_number, status, phase,
        started_at, initial_completed_at, deadline_at, completed_at,
        question_count_snapshot, passing_score_snapshot,
        retry_passing_score_snapshot, unresolved_wrong_count,
        initial_score, final_score, passed
      )
      select
        ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        '${studentId}',
        ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        1, 'completed', 'completed',
        '2026-08-20T00:00:00.000Z',
        '2026-08-28T00:00:00.000Z',
        '2026-08-28T01:00:00.000Z',
        '2026-08-28T00:00:00.000Z',
        20, 80, null, 0, 90, 90, true
      from generate_series(1, 21) as series(i);
    `);
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it("현재 전체와 완료 10+1, 다섯 개수를 같은 snapshot으로 반환한다", async () => {
    const result = await database.query<InitialRow>(`
      select * from public.get_student_dashboard_initial_v1(
        '${studentId}', '${snapshotAt}'
      )
    `);
    const row = result.rows[0];
    const legacyFullList = await database.query<{ items: unknown[] }>(`
      select coalesce(
        jsonb_agg(item order by effective_at desc, assignment_id asc),
        '[]'::jsonb
      ) as items
      from private.student_dashboard_read_rows_v1(
        '${studentId}', '${snapshotAt}'
      )
    `);

    expect(row?.snapshot_at.toISOString()).toBe(snapshotAt);
    expect(Number(row?.completed_count)).toBe(21);
    expect(row?.completed_items).toHaveLength(11);
    expect(row?.completed_items.map((node) => node.assignmentId))
      .toEqual(Array.from({ length: 11 }, (_, index) => assignmentId(index + 1)));
    expect(Number(row?.open_count)).toBe(12);
    expect(row?.current_items).toHaveLength(12);
    expect(row?.current_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assignmentId: assignmentId(22),
        dashboardSection: "open",
      }),
      expect.objectContaining({
        assignmentId: assignmentId(33),
        dashboardSection: "open",
      }),
    ]));
    expect(row?.completed_items[0]?.item).toMatchObject({
      passingScore: 80,
      questionCount: 20,
    });

    const boundedClientPayload = {
      completedPage: {
        items: row?.completed_items.slice(0, 10).map((node) => node.item),
        nextCursor: "x".repeat(256),
      },
      currentAssignments: row?.current_items.map((node) => node.item),
      sectionCounts: {
        completed: row?.completed_count,
        deadlineClosed: row?.deadline_closed_count,
        needsAttention: row?.needs_attention_count,
        open: row?.open_count,
        scheduled: row?.scheduled_count,
      },
      snapshotAt: row?.snapshot_at.toISOString(),
    };
    const legacyFullPayload = legacyFullList.rows[0]?.items ?? [];

    expect(legacyFullPayload).toHaveLength(33);
    expect(Buffer.byteLength(JSON.stringify(boundedClientPayload), "utf8"))
      .toBeLessThan(
        Buffer.byteLength(JSON.stringify(legacyFullPayload), "utf8"),
      );
  });

  it("동일 완료 시각 21건을 ID 보조 정렬로 10, 10, 1 연결한다", async () => {
    const firstCursorId = assignmentId(10);
    const second = await database.query<PageRow>(`
      select * from public.list_student_dashboard_completed_page_v1(
        '${studentId}', '${snapshotAt}',
        '2026-08-28T00:00:00.000Z', '${firstCursorId}'
      )
    `);
    expect(second.rows.map((row) => row.cursor_assignment_id))
      .toEqual(Array.from({ length: 11 }, (_, index) => assignmentId(index + 11)));

    const third = await database.query<PageRow>(`
      select * from public.list_student_dashboard_completed_page_v1(
        '${studentId}', '${snapshotAt}',
        '2026-08-28T00:00:00.000Z', '${assignmentId(20)}'
      )
    `);
    expect(third.rows.map((row) => row.cursor_assignment_id))
      .toEqual([assignmentId(21)]);
  });

  it("배정 현재값 수정과 snapshot 뒤 새 완료가 기존 페이지를 흔들지 않는다", async () => {
    await database.exec(`
      update public.assignments
      set passing_score = 100, question_count = 77
      where id = '${assignmentId(1)}';

      insert into public.quiz_attempts (
        id, student_id, assignment_id, attempt_number, status, phase,
        started_at, initial_completed_at, deadline_at, completed_at,
        question_count_snapshot, passing_score_snapshot,
        retry_passing_score_snapshot, unresolved_wrong_count,
        initial_score, final_score, passed
      ) values (
        '10000000-0000-4000-8000-000000000022',
        '${studentId}', '${assignmentId(22)}', 1, 'completed', 'completed',
        '2026-08-29T00:00:01.000Z', '2026-08-29T00:00:02.000Z',
        '2026-08-29T00:05:00.000Z', '2026-08-29T00:00:02.000Z',
        15, 80, null, 0, 100, 100, true
      );
    `);

    const oldSnapshot = await database.query<InitialRow>(`
      select * from public.get_student_dashboard_initial_v1(
        '${studentId}', '${snapshotAt}'
      )
    `);
    expect(Number(oldSnapshot.rows[0]?.completed_count)).toBe(21);
    expect(Number(oldSnapshot.rows[0]?.open_count)).toBe(12);
    expect(oldSnapshot.rows[0]?.completed_items[0]?.item).toMatchObject({
      passingScore: 80,
      questionCount: 20,
    });

    const refreshed = await database.query<InitialRow>(`
      select * from public.get_student_dashboard_initial_v1(
        '${studentId}', '2026-08-29T00:01:00.000Z'
      )
    `);
    expect(Number(refreshed.rows[0]?.completed_count)).toBe(22);
    expect(Number(refreshed.rows[0]?.open_count)).toBe(11);
  });

  it("유효하지 않은 미래 snapshot과 역방향 커서를 명시 오류로 거부한다", async () => {
    await expect(database.query(`
      select * from public.get_student_dashboard_initial_v1(
        '${studentId}', 'infinity'
      )
    `)).rejects.toThrow("invalid student dashboard snapshot");
    await expect(database.query(`
      select * from public.list_student_dashboard_completed_page_v1(
        '${studentId}', '${snapshotAt}',
        '2026-08-29T00:00:01.000Z', '${assignmentId(10)}'
      )
    `)).rejects.toThrow("invalid student dashboard cursor");
  });
});
