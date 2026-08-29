import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829213000_add_admin_student_directory_read_model.sql",
  ),
  "utf8",
);

const snapshotAt = new Date(Date.now() - 60_000).toISOString();

type InitialRow = {
  filter_options: {
    classGroups: Array<{ id: string; name: string }>;
    grades: string[];
    schools: string[];
    wordbooks: string[];
  };
  items: Array<{
    item: { id: string; rawPoints: number };
    sortAt: string;
    studentId: string;
  }>;
  snapshot_at: Date;
  total_count: string;
};

type PageRow = {
  cursor_sort_at: Date;
  cursor_student_id: string;
  item: { id: string };
};

function studentId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("admin student directory read model SQL", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;

      create function private.is_active_admin()
      returns boolean language sql stable as $$ select true $$;
      create function private.vocab_identity_matches_v1(
        uuid, bigint, text, uuid, text,
        uuid, bigint, text, uuid, text
      ) returns boolean language sql stable as $$ select false $$;

      create table public.students (
        id uuid primary key,
        display_name text not null,
        school_name text,
        grade_label text,
        status text not null,
        current_vocab_dataset_id uuid,
        current_vocab_book text,
        reading_curriculum_stage text not null default 'undecided',
        reading_context_sync_status text not null default 'not_synced',
        created_at timestamptz not null,
        deleted_at timestamptz
      );
      create table public.student_codes (
        student_id uuid primary key,
        status text not null,
        expires_at timestamptz
      );
      create table public.vocab_datasets (
        id uuid primary key,
        title text not null
      );
      create table public.vocab_dataset_catalog (
        dataset_id uuid primary key,
        display_name text not null
      );
      create table public.student_learning_sources (
        id uuid primary key,
        student_id uuid not null,
        source_type text not null,
        vocab_dataset_id uuid,
        display_label text not null,
        range_metadata jsonb not null default '{}'::jsonb,
        active boolean not null,
        sort_order integer not null default 0,
        created_at timestamptz not null
      );
      create table public.class_groups (
        id uuid primary key,
        name text not null,
        active boolean not null
      );
      create table public.class_group_students (
        class_group_id uuid not null,
        student_id uuid not null
      );
      create table public.student_point_totals (
        student_id uuid primary key,
        total_points bigint not null
      );
      create table public.quiz_attempts (
        id uuid primary key,
        completed_at timestamptz,
        unresolved_wrong_count integer
      );
      create table public.student_vocab_state (
        student_id uuid not null,
        vocab_entry_id bigint not null,
        unresolved_wrong_count integer not null,
        resolved_at timestamptz,
        canonical_dictionary_id_snapshot text
      );
      create table public.vocab_entries (
        id bigint primary key,
        dataset_id uuid not null,
        headword_normalized text not null
      );
      create table public.vocab_entry_quiz_eligibility (
        vocab_entry_id bigint not null,
        dataset_id uuid not null,
        status text not null,
        canonical_lexeme_id uuid
      );
      create table public.student_vocab_wrong_events (
        student_id uuid not null,
        dataset_id uuid not null,
        vocab_entry_id bigint not null,
        quiz_attempt_id uuid not null,
        canonical_dictionary_id_snapshot text,
        canonical_lexeme_id_snapshot uuid,
        wrong_stage text not null
      );

      create table private.test_admin_history_rows (
        entry_key text,
        row_id text,
        assignment_id uuid,
        student_id uuid,
        attempt_id uuid,
        attempt_number integer,
        activity_at timestamptz,
        recorded_at timestamptz,
        effective_at timestamptz,
        activity_section text,
        filter_bucket text,
        is_hidden boolean,
        assignment_deleted boolean,
        student_deleted boolean,
        list_item jsonb,
        detail_item jsonb,
        search_text text
      );
      create function private.admin_history_read_rows_v1(
        p_snapshot_at timestamptz,
        p_attempt_id uuid default null,
        p_assignment_id uuid default null,
        p_student_id uuid default null,
        p_payload text default 'list'
      ) returns table (
        entry_key text,
        row_id text,
        assignment_id uuid,
        student_id uuid,
        attempt_id uuid,
        attempt_number integer,
        activity_at timestamptz,
        recorded_at timestamptz,
        effective_at timestamptz,
        activity_section text,
        filter_bucket text,
        is_hidden boolean,
        assignment_deleted boolean,
        student_deleted boolean,
        list_item jsonb,
        detail_item jsonb,
        search_text text
      ) language sql stable as $$
        select *
        from private.test_admin_history_rows as history
        where (p_attempt_id is null or history.attempt_id = p_attempt_id)
          and (
            p_assignment_id is null
            or history.assignment_id = p_assignment_id
          )
          and (p_student_id is null or history.student_id = p_student_id)
      $$;
    `);
    await database.exec(migration);
    await database.exec(`
      insert into public.students (
        id, display_name, school_name, grade_label, status,
        created_at
      )
      select
        ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        '가짜 학생 ' || lpad(i::text, 2, '0'),
        case when i <= 11 then '미리보기고' else '검증고' end,
        case when i % 2 = 0 then '고2' else '고3' end,
        case when i = 21 then 'blocked' else 'active' end,
        '2024-08-01T00:00:00.000Z'
      from generate_series(1, 21) as series(i);

      insert into public.student_codes (student_id, status, expires_at)
      select id, 'active', '2027-01-01T00:00:00.000Z'
      from public.students;

      insert into public.student_point_totals values
        ('${studentId(1)}', -3),
        ('${studentId(2)}', 5);

      insert into public.quiz_attempts (id, completed_at, unresolved_wrong_count)
      select
        ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        null,
        null
      from generate_series(1, 21) as series(i);

      insert into private.test_admin_history_rows (
        entry_key, row_id, assignment_id, student_id, attempt_id,
        attempt_number, activity_at, recorded_at, effective_at,
        activity_section, filter_bucket, is_hidden, assignment_deleted,
        student_deleted, list_item, detail_item, search_text
      )
      select
        'attempt.' || attempt.id,
        attempt.id::text,
        ('20000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        '${studentId(1)}',
        attempt.id,
        i,
        '2026-08-01T00:00:00.000Z'::timestamptz + i * interval '1 day',
        '2026-08-01T00:00:00.000Z'::timestamptz + i * interval '1 day',
        '2026-08-01T00:00:00.000Z'::timestamptz + i * interval '1 day',
        'completed',
        'completed',
        false,
        false,
        false,
        jsonb_build_object(
          'assignmentPurpose', 'regular',
          'status', 'completed',
          'passingScore', 80,
          'initialScore', 100,
          'finalScore', 100,
          'passed', true,
          'startedAt', '2026-08-01T00:00:00.000Z'::timestamptz + i * interval '1 day',
          'initialCompletedAt', '2026-08-01T00:10:00.000Z'::timestamptz + i * interval '1 day',
          'retryStartedAt', null,
          'completedAt', '2026-08-01T00:10:00.000Z'::timestamptz + i * interval '1 day'
        ),
        jsonb_build_object(
          'datasetId', '30000000-0000-4000-8000-000000000001',
          'assignmentPurpose', 'regular',
          'status', 'completed'
        ),
        '가짜 학생 01'
      from generate_series(1, 21) as series(i)
      join public.quiz_attempts as attempt
        on attempt.id = (
          '10000000-0000-4000-8000-' || lpad(i::text, 12, '0')
        )::uuid;
    `);
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it("21명을 11행까지만 읽고 원장 포인트 부호를 보존한다", async () => {
    const result = await database.query<InitialRow>(`
      select * from public.get_admin_student_directory_initial_v1(
        '', '', '', 'all', null, '', 'all',
        '${snapshotAt}', 11
      )
    `);
    const row = result.rows[0];
    expect(Number(row?.total_count)).toBe(21);
    expect(row?.items).toHaveLength(11);
    expect(row?.items[0]?.item).toMatchObject({
      id: studentId(1),
      rawPoints: -3,
    });
    expect(row?.items[1]?.item).toMatchObject({
      id: studentId(2),
      rawPoints: 5,
    });
  });

  it("동일 정렬 시각을 학생 ID로 10, 10, 1 연결한다", async () => {
    const second = await database.query<PageRow>(`
      select * from public.list_admin_student_directory_page_v1(
        '', '', '', 'all', null, '', 'all',
        '${snapshotAt}',
        '2024-08-01T00:00:00.000Z', '${studentId(10)}', 11
      )
    `);
    expect(second.rows.map((row) => row.cursor_student_id)).toEqual(
      Array.from({ length: 11 }, (_, index) => studentId(index + 11)),
    );

    const third = await database.query<PageRow>(`
      select * from public.list_admin_student_directory_page_v1(
        '', '', '', 'all', null, '', 'all',
        '${snapshotAt}',
        '2024-08-01T00:00:00.000Z', '${studentId(20)}', 11
      )
    `);
    expect(third.rows.map((row) => row.cursor_student_id))
      .toEqual([studentId(21)]);
  });

  it("학교·학년·상태 필터와 필터 선택지를 같은 응답에 반환한다", async () => {
    const result = await database.query<InitialRow>(`
      select * from public.get_admin_student_directory_initial_v1(
        '', '미리보기고', '고3', 'active', null, '', 'all',
        '${snapshotAt}', 11
      )
    `);
    expect(Number(result.rows[0]?.total_count)).toBe(6);
    expect(result.rows[0]?.filter_options.schools)
      .toEqual(['검증고', '미리보기고']);
    expect(result.rows[0]?.filter_options.grades).toEqual(['고2', '고3']);
  });

  it("유효하지 않은 미래 snapshot과 역방향 커서를 거절한다", async () => {
    await expect(database.query(`
      select * from public.get_admin_student_directory_initial_v1(
        '', '', '', 'all', null, '', 'all', 'infinity', 11
      )
    `)).rejects.toThrow("invalid student directory request");
    await expect(database.query(`
      select * from public.list_admin_student_directory_page_v1(
        '', '', '', 'all', null, '', 'all',
        '${snapshotAt}',
        'infinity', '${studentId(10)}', 11
      )
    `)).rejects.toThrow("invalid student directory cursor");
  });

  it("선택 학생 상세만 읽고 이력을 11행 seek 페이지로 나눈다", async () => {
    const detail = await database.query<{ detail: {
      student: { id: string; rawPoints: number };
      vocabBookHistory: Array<{ attemptCount: number }>;
    } }>(`
      select public.get_admin_student_detail_initial_v1(
        '${studentId(1)}', '${snapshotAt}'
      ) as detail
    `);
    expect(detail.rows[0]?.detail.student).toEqual(expect.objectContaining({
      id: studentId(1),
      rawPoints: -3,
    }));
    expect(detail.rows[0]?.detail.vocabBookHistory[0]?.attemptCount).toBe(21);

    const initial = await database.query<{
      items: unknown[];
      total_count: string;
    }>(`
      select * from public.get_admin_student_history_initial_v1(
        '${studentId(1)}', 'all', 'all', null, '${snapshotAt}', 11
      )
    `);
    expect(Number(initial.rows[0]?.total_count)).toBe(21);
    expect(initial.rows[0]?.items).toHaveLength(11);

    const page = await database.query<{ cursor_entry_key: string }>(`
      select * from public.list_admin_student_history_page_v1(
        '${studentId(1)}', 'all', 'all', null, '${snapshotAt}',
        '2026-08-12T00:00:00.000Z',
        'attempt.10000000-0000-4000-8000-000000000011',
        11
      )
    `);
    expect(page.rows).toHaveLength(10);
  });

  it("내부 보조 함수도 관리자가 아니면 학생 자료를 직접 반환하지 않는다", async () => {
    await database.exec("begin");
    try {
      await database.exec(`
        create or replace function private.is_active_admin()
        returns boolean language sql stable as $$ select false $$;
      `);
      const wrongCounts = await database.query(`
        select *
        from private.admin_student_current_wrong_counts_v1(
          array['${studentId(1)}']::uuid[]
        )
      `);
      const directoryRows = await database.query(`
        select *
        from private.admin_student_directory_rows_v1('${snapshotAt}', true)
      `);
      const filteredRows = await database.query(`
        select *
        from private.admin_student_directory_filtered_rows_v1(
          '${snapshotAt}', '', '', '', 'all', null, '', 'all'
        )
      `);
      const historyRows = await database.query(`
        select *
        from private.admin_student_history_filtered_rows_v1(
          '${studentId(1)}', 'all', 'all', null, '${snapshotAt}'
        )
      `);

      expect(wrongCounts.rows).toHaveLength(0);
      expect(directoryRows.rows).toHaveLength(0);
      expect(filteredRows.rows).toHaveLength(0);
      expect(historyRows.rows).toHaveLength(0);
    } finally {
      await database.exec("rollback");
    }
  });
});
