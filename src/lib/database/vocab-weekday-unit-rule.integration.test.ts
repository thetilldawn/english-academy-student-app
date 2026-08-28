import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829120000_preserve_vocab_weekday_unit_rules.sql",
  ),
  "utf8",
);

const requestId = "00000000-0000-4000-8000-000000000001";
const studentId = "00000000-0000-4000-8000-000000000002";
const datasetId = "00000000-0000-4000-8000-000000000003";
const unitIds = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
  "00000000-0000-4000-8000-000000000104",
];

function validSeries(overrides: Record<string, unknown> = {}) {
  return [{
    student_id: studentId,
    dataset_id: datasetId,
    dataset_label: "검증 단어장",
    range_label: "DAY 1~4",
    split_basis: "range_unit",
    resolved_plan_sha256: "a".repeat(64),
    recurrence_slots: [
      { isodow: 1, local_time: "16:00:00", duration_seconds: 21600 },
      { isodow: 3, local_time: "16:00:00", duration_seconds: 21600 },
    ],
    allocation_rule: {
      schema_version: 1,
      mode: "by_weekday",
      units_per_session: 1,
      weekday_units_per_session: [
        { isodow: 1, unit_count: 2 },
        { isodow: 2, unit_count: 1 },
        { isodow: 3, unit_count: 3 },
        { isodow: 4, unit_count: 1 },
        { isodow: 5, unit_count: 1 },
        { isodow: 6, unit_count: 1 },
        { isodow: 7, unit_count: 1 },
      ],
      base_session_unit_counts: [2, 3],
      ordered_unit_ids: unitIds,
      overflow_policy: "continue_weekly",
      extra_date_policy: "unconfirmed",
    },
    items: [],
    ...overrides,
  }];
}

describe("요일별 단위 규칙 queue migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema extensions;
      create extension pgcrypto with schema extensions;
      create schema private;

      create table private.vocab_assignment_queue_requests (
        idempotency_key uuid primary key,
        request_sha256 text not null,
        payload_sha256 text not null
      );
      create table private.vocab_assignment_series (
        id uuid primary key default extensions.gen_random_uuid(),
        request_id uuid not null,
        student_id uuid not null,
        recurrence_slots jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default clock_timestamp(),
        updated_at timestamptz not null default clock_timestamp(),
        unique (request_id, student_id)
      );
      create table private.vocab_assignment_series_items (
        id uuid primary key default extensions.gen_random_uuid(),
        series_id uuid not null,
        assignment_id uuid
      );
      create function private.is_active_admin()
      returns boolean
      language sql
      stable
      set search_path = ''
      as $$ select true; $$;
      create function private.create_vocab_assignment_queues_v1(
        p_idempotency_key uuid,
        p_request_sha256 text,
        p_series jsonb
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = ''
      as $$
      declare
        payload_sha text;
        request_row private.vocab_assignment_queue_requests%rowtype;
      begin
        if jsonb_array_length(p_series) not between 1 and 210 then
          raise exception 'invalid_vocab_assignment_queue'
            using errcode = '22023';
        end if;
        payload_sha := encode(
          extensions.digest(convert_to(p_series::text, 'UTF8'), 'sha256'),
          'hex'
        );
        insert into private.vocab_assignment_queue_requests (
          idempotency_key, request_sha256, payload_sha256
        ) values (
          p_idempotency_key, p_request_sha256, payload_sha
        ) on conflict (idempotency_key) do nothing;
        select request.* into request_row
        from private.vocab_assignment_queue_requests as request
        where request.idempotency_key = p_idempotency_key;
        if request_row.request_sha256 <> p_request_sha256
          or request_row.payload_sha256 <> payload_sha
        then
          raise exception 'idempotency_key_reused' using errcode = '23505';
        end if;
        insert into private.vocab_assignment_series (
          request_id, student_id, recurrence_slots
        )
        select
          p_idempotency_key,
          (series.value ->> 'student_id')::uuid,
          series.value -> 'recurrence_slots'
        from jsonb_array_elements(p_series) as series(value)
        on conflict (request_id, student_id) do nothing;
        return jsonb_build_object('ok', true);
      end;
      $$;
      create function public.create_vocab_assignment_queues_v2(
        p_idempotency_key uuid,
        p_request_sha256 text,
        p_series jsonb
      )
      returns jsonb
      language sql
      security definer
      set search_path = ''
      as $$
        select private.create_vocab_assignment_queues_v1(
          p_idempotency_key, p_request_sha256, p_series
        );
      $$;
      create function public.list_vocab_assignment_queue_summaries_v1(
        p_include_closed boolean default false,
        p_student_id uuid default null,
        p_before_updated_at timestamptz default null,
        p_before_series_id uuid default null,
        p_limit integer default null
      )
      returns table (
        series_id uuid,
        student_id uuid,
        status text,
        attention_reason text,
        dataset_label text,
        range_label text,
        total_session_count integer,
        completed_session_count integer,
        remaining_session_count integer,
        total_question_count integer,
        remaining_question_count integer,
        current_assignment_id uuid,
        next_available_from timestamptz,
        next_available_until timestamptz,
        items jsonb,
        created_at timestamptz,
        updated_at timestamptz
      )
      language sql
      security definer
      set search_path = ''
      as $$
        select
          series.id,
          series.student_id,
          'active'::text,
          null::text,
          '검증 단어장'::text,
          'DAY 1~4'::text,
          0,
          0,
          0,
          0,
          0,
          null::uuid,
          null::timestamptz,
          null::timestamptz,
          '[]'::jsonb,
          series.created_at,
          series.updated_at
        from private.vocab_assignment_series as series
        where (p_student_id is null or series.student_id = p_student_id)
        order by series.updated_at desc, series.id desc
        limit p_limit;
      $$;
    `);
    await database.exec(migration);
  }, 30_000);

  afterAll(async () => {
    await database.close();
  });

  it("규칙·규칙 해시·미리보기 해시를 series에 원자적으로 보존한다", async () => {
    const series = validSeries();
    await database.query(`
      select public.create_vocab_assignment_queues_v3(
        '${requestId}',
        '${"b".repeat(64)}',
        $series$${JSON.stringify(series)}$series$::jsonb
      );
    `);
    const stored = await database.query<{
      split_basis: string;
      allocation_rule: Record<string, unknown>;
      allocation_rule_sha256: string;
      resolved_plan_sha256: string;
    }>(`
      select
        series.split_basis,
        series.allocation_rule,
        series.allocation_rule_sha256,
        request.resolved_plan_sha256
      from private.vocab_assignment_series as series
      join private.vocab_assignment_queue_requests as request
        on request.idempotency_key = series.request_id
      where series.request_id = '${requestId}';
    `);

    expect(stored.rows[0]).toMatchObject({
      split_basis: "range_unit",
      allocation_rule: {
        schema_version: 1,
        mode: "by_weekday",
        base_session_unit_counts: [2, 3],
      },
      allocation_rule_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      resolved_plan_sha256: "a".repeat(64),
    });

    const timestampBeforeReplay = await database.query<{ updated_at: string }>(`
      select updated_at::text as updated_at
      from private.vocab_assignment_series
      where request_id = '${requestId}';
    `);

    await database.query(`
      select public.create_vocab_assignment_queues_v3(
        '${requestId}',
        '${"b".repeat(64)}',
        $series$${JSON.stringify(series)}$series$::jsonb
      );
    `);
    const timestampAfterReplay = await database.query<{ updated_at: string }>(`
      select updated_at::text as updated_at
      from private.vocab_assignment_series
      where request_id = '${requestId}';
    `);
    expect(timestampAfterReplay.rows[0]?.updated_at)
      .toBe(timestampBeforeReplay.rows[0]?.updated_at);
    const count = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from private.vocab_assignment_series
      where request_id = '${requestId}';
    `);
    expect(count.rows[0]?.count).toBe(1);

    const assignmentId = "00000000-0000-4000-8000-000000000031";
    await database.exec(`
      insert into private.vocab_assignment_series_items (
        series_id, assignment_id
      )
      select id, '${assignmentId}'
      from private.vocab_assignment_series
      where request_id = '${requestId}';
    `);
    const lookup = await database.query<{
      assignment_id: string;
      allocation_rule: Record<string, unknown>;
    }>(`
      select *
      from public.list_vocab_assignment_unit_rules_v1(
        array['${assignmentId}'::uuid]
      );
    `);
    expect(lookup.rows[0]).toMatchObject({
      assignment_id: assignmentId,
      allocation_rule: { mode: "by_weekday" },
    });
    const summary = await database.query<{
      allocation_rule: Record<string, unknown>;
      recurrence_weekdays: number[];
    }>(`
      select allocation_rule, recurrence_weekdays
      from public.list_vocab_assignment_queue_summaries_v2(
        false, '${studentId}', null, null, null
      );
    `);
    expect(summary.rows[0]).toMatchObject({
      allocation_rule: { mode: "by_weekday" },
      recurrence_weekdays: [1, 3],
    });
  });

  it("잘못된 요일 규칙은 기존 생성 함수를 부르기 전에 전부 거부한다", async () => {
    const invalidRequest = "00000000-0000-4000-8000-000000000011";
    const invalid = validSeries({
      allocation_rule: {
        ...validSeries()[0]!.allocation_rule as Record<string, unknown>,
        base_session_unit_counts: [2, 2],
      },
    });
    await expect(database.query(`
      select public.create_vocab_assignment_queues_v3(
        '${invalidRequest}',
        '${"c".repeat(64)}',
        $series$${JSON.stringify(invalid)}$series$::jsonb
      );
    `)).rejects.toMatchObject({ code: "22023" });
    const counts = await database.query<{ requests: number; series: number }>(`
      select
        (select count(*)::integer from private.vocab_assignment_queue_requests
          where idempotency_key = '${invalidRequest}') as requests,
        (select count(*)::integer from private.vocab_assignment_series
          where request_id = '${invalidRequest}') as series;
    `);
    expect(counts.rows[0]).toEqual({ requests: 0, series: 0 });
  });

  it("필수 규칙 배열이 빠진 요청은 저장하지 않는다", async () => {
    const invalidRequest = "00000000-0000-4000-8000-000000000012";
    const invalid = validSeries({
      allocation_rule: {
        schema_version: 1,
        mode: "by_weekday",
        units_per_session: 1,
        overflow_policy: "leave",
        extra_date_policy: "unconfirmed",
      },
    });
    await expect(database.query(`
      select public.create_vocab_assignment_queues_v3(
        '${invalidRequest}',
        '${"e".repeat(64)}',
        $series$${JSON.stringify(invalid)}$series$::jsonb
      );
    `)).rejects.toMatchObject({ code: "22023" });
    const counts = await database.query<{ requests: number; series: number }>(`
      select
        (select count(*)::integer from private.vocab_assignment_queue_requests
          where idempotency_key = '${invalidRequest}') as requests,
        (select count(*)::integer from private.vocab_assignment_series
          where request_id = '${invalidRequest}') as series;
    `);
    expect(counts.rows[0]).toEqual({ requests: 0, series: 0 });
  });

  it("rejects numeric strings before the legacy writer stores anything", async () => {
    const cases: Array<{
      requestId: string;
      mutate: (rule: Record<string, unknown>) => void;
    }> = [
      {
        requestId: "00000000-0000-4000-8000-000000000014",
        mutate: (rule) => { rule.schema_version = "1"; },
      },
      {
        requestId: "00000000-0000-4000-8000-000000000015",
        mutate: (rule) => { rule.units_per_session = "1"; },
      },
      {
        requestId: "00000000-0000-4000-8000-000000000016",
        mutate: (rule) => {
          const weekdays = rule.weekday_units_per_session as Array<
            Record<string, unknown>
          >;
          weekdays[0]!.isodow = "1";
        },
      },
      {
        requestId: "00000000-0000-4000-8000-000000000017",
        mutate: (rule) => {
          const weekdays = rule.weekday_units_per_session as Array<
            Record<string, unknown>
          >;
          weekdays[0]!.unit_count = "2";
        },
      },
    ];

    for (const testCase of cases) {
      const invalid = validSeries();
      testCase.mutate(
        invalid[0]!.allocation_rule as Record<string, unknown>,
      );
      await expect(database.query(`
        select public.create_vocab_assignment_queues_v3(
          '${testCase.requestId}',
          '${"9".repeat(64)}',
          $series$${JSON.stringify(invalid)}$series$::jsonb
        );
      `)).rejects.toMatchObject({ code: "22023" });
      const counts = await database.query<{
        requests: number;
        series: number;
      }>(`
        select
          (select count(*)::integer
            from private.vocab_assignment_queue_requests
            where idempotency_key = '${testCase.requestId}') as requests,
          (select count(*)::integer
            from private.vocab_assignment_series
            where request_id = '${testCase.requestId}') as series;
      `);
      expect(counts.rows[0]).toEqual({ requests: 0, series: 0 });
    }
  });

  it("31명 요청도 기존 210시험 상한 안에서 저장한다", async () => {
    const boundaryRequest = "00000000-0000-4000-8000-000000000013";
    const template = validSeries()[0]!;
    const series = Array.from({ length: 31 }, (_, index) => ({
      ...template,
      student_id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
    }));
    await database.query(`
      select public.create_vocab_assignment_queues_v3(
        '${boundaryRequest}',
        '${"f".repeat(64)}',
        $series$${JSON.stringify(series)}$series$::jsonb
      );
    `);
    const stored = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from private.vocab_assignment_series
      where request_id = '${boundaryRequest}';
    `);
    expect(stored.rows[0]?.count).toBe(31);
  });

  it("기존 v2 자료는 새 규칙 컬럼을 null로 둔 채 계속 저장한다", async () => {
    const legacyRequest = "00000000-0000-4000-8000-000000000021";
    const legacy = [{
      student_id: "00000000-0000-4000-8000-000000000022",
      recurrence_slots: [{ isodow: 1 }],
      items: [],
    }];
    await database.query(`
      select public.create_vocab_assignment_queues_v2(
        '${legacyRequest}',
        '${"d".repeat(64)}',
        $series$${JSON.stringify(legacy)}$series$::jsonb
      );
    `);
    const stored = await database.query<{
      split_basis: string | null;
      allocation_rule: unknown;
      allocation_rule_sha256: string | null;
    }>(`
      select split_basis, allocation_rule, allocation_rule_sha256
      from private.vocab_assignment_series
      where request_id = '${legacyRequest}';
    `);
    expect(stored.rows[0]).toEqual({
      split_basis: null,
      allocation_rule: null,
      allocation_rule_sha256: null,
    });
  });

  it("private helper는 앱 역할이 직접 실행할 수 없다", async () => {
    const privilege = await database.query<{ allowed: boolean }>(`
      select has_function_privilege(
        'authenticated',
        'private.create_vocab_assignment_queues_v2(uuid,text,jsonb)',
        'execute'
      ) as allowed;
    `);
    expect(privilege.rows[0]?.allowed).toBe(false);
  });
});
