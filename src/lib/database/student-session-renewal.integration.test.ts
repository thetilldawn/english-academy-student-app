import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260826001652_bound_student_session_renewal.sql",
  ),
  "utf8",
);

const studentId = "00000000-0000-4000-8000-000000000001";

describe.sequential("bounded student session renewal", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create schema auth;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;

      create function auth.jwt()
      returns jsonb
      language sql
      stable
      as $$
        select coalesce(
          nullif(current_setting('request.jwt.claims', true), ''),
          '{}'
        )::jsonb;
      $$;

      create table public.students (
        id uuid primary key,
        status text not null,
        code_generation integer not null,
        deleted_at timestamptz
      );

      create table public.student_sessions (
        id uuid primary key,
        student_id uuid not null references public.students(id),
        token_hash text not null unique,
        code_generation integer not null,
        expires_at timestamptz not null,
        last_seen_at timestamptz not null,
        revoked_at timestamptz
      );
    `);
    await database.exec(migration);
  });

  beforeEach(async () => {
    await database.exec(`
      select set_config(
        'request.jwt.claims',
        '{"role":"service_role"}',
        false
      );
      truncate table public.student_sessions;
      truncate table public.students cascade;
      insert into public.students (id, status, code_generation)
      values ('${studentId}', 'active', 1);
    `);
  });

  afterAll(async () => {
    await database.close();
  });

  it("24시간 안의 정상 세션은 확인만 하고 시각을 변경하지 않는다", async () => {
    await database.exec(`
      insert into public.student_sessions (
        id, student_id, token_hash, code_generation, expires_at, last_seen_at
      ) values (
        '00000000-0000-4000-8000-000000000101',
        '${studentId}',
        'fresh-token-hash-0001',
        1,
        clock_timestamp() + interval '59 days',
        clock_timestamp() - interval '1 hour'
      );
    `);
    const before = await database.query<{ seen: string }>(`
      select extract(epoch from last_seen_at)::text as seen
      from public.student_sessions;
    `);
    const renewal = await database.query<{ renewed: boolean }>(`
      select renewed
      from public.renew_student_session_v2('fresh-token-hash-0001');
    `);
    const after = await database.query<{ seen: string }>(`
      select extract(epoch from last_seen_at)::text as seen
      from public.student_sessions;
    `);

    expect(renewal.rows).toEqual([{ renewed: false }]);
    expect(after.rows[0]?.seen).toBe(before.rows[0]?.seen);
  });

  it("24시간이 지난 첫 명령만 갱신하고 바로 재실행하면 쓰지 않는다", async () => {
    await database.exec(`
      insert into public.student_sessions (
        id, student_id, token_hash, code_generation, expires_at, last_seen_at
      ) values (
        '00000000-0000-4000-8000-000000000102',
        '${studentId}',
        'stale-token-hash-0002',
        1,
        clock_timestamp() + interval '58 days',
        clock_timestamp() - interval '25 hours'
      );
    `);
    const first = await database.query<{ renewed: boolean }>(`
      select renewed
      from public.renew_student_session_v2('stale-token-hash-0002');
    `);
    const afterFirst = await database.query<{ seen: string; remaining_days: number }>(`
      select
        extract(epoch from last_seen_at)::text as seen,
        extract(epoch from (expires_at - clock_timestamp())) / 86400 as remaining_days
      from public.student_sessions;
    `);
    const second = await database.query<{ renewed: boolean }>(`
      select renewed
      from public.renew_student_session_v2('stale-token-hash-0002');
    `);
    const afterSecond = await database.query<{ seen: string }>(`
      select extract(epoch from last_seen_at)::text as seen
      from public.student_sessions;
    `);

    expect(first.rows).toEqual([{ renewed: true }]);
    expect(second.rows).toEqual([{ renewed: false }]);
    expect(afterSecond.rows[0]?.seen).toBe(afterFirst.rows[0]?.seen);
    expect(Number(afterFirst.rows[0]?.remaining_days)).toBeGreaterThan(59.9);
  });

  it("24시간 직전에는 쓰지 않고 경계에 도달하면 한 번만 쓴다", async () => {
    await database.exec(`
      insert into public.student_sessions (
        id, student_id, token_hash, code_generation, expires_at, last_seen_at
      ) values (
        '00000000-0000-4000-8000-000000000103',
        '${studentId}',
        'boundary-token-hash-0003',
        1,
        clock_timestamp() + interval '59 days',
        clock_timestamp() - interval '23 hours 59 minutes 58 seconds'
      );
    `);
    const beforeBoundary = await database.query<{ renewed: boolean }>(`
      select renewed
      from public.renew_student_session_v2('boundary-token-hash-0003');
    `);
    await database.exec(`
      update public.student_sessions
      set last_seen_at = clock_timestamp() - interval '24 hours'
      where token_hash = 'boundary-token-hash-0003';
    `);
    const atBoundary = await database.query<{ renewed: boolean }>(`
      select renewed
      from public.renew_student_session_v2('boundary-token-hash-0003');
    `);

    expect(beforeBoundary.rows).toEqual([{ renewed: false }]);
    expect(atBoundary.rows).toEqual([{ renewed: true }]);
  });

  it("마지막 활동 59일은 갱신하고 60일 이상은 되살리지 않는다", async () => {
    for (const [index, [idleDays, expectedRows]] of [
      [59, 1],
      [60, 0],
      [61, 0],
    ].entries()) {
      const token = `idle-boundary-token-${idleDays}`;
      const sessionId = `00000000-0000-4000-8000-${String(300 + index).padStart(12, "0")}`;
      await database.exec(`
        insert into public.student_sessions (
          id, student_id, token_hash, code_generation, expires_at, last_seen_at
        ) values (
          '${sessionId}',
          '${studentId}',
          '${token}',
          1,
          clock_timestamp() + interval '1 day',
          clock_timestamp() - interval '${idleDays} days'
        );
      `);
      const result = await database.query(`
        select * from public.renew_student_session_v2('${token}');
      `);
      expect(result.rows).toHaveLength(expectedRows);
      await database.exec("truncate table public.student_sessions;");
    }
  });

  it("만료·회수·차단·삭제·코드 회전 세션은 모두 결과를 반환하지 않는다", async () => {
    const cases = [
      ["expired-token-hash-01", "clock_timestamp() - interval '1 second'", "null", "active", "null", 1],
      ["revoked-token-hash-01", "clock_timestamp() + interval '1 day'", "clock_timestamp()", "active", "null", 1],
      ["blocked-token-hash-01", "clock_timestamp() + interval '1 day'", "null", "blocked", "null", 1],
      ["deleted-token-hash-01", "clock_timestamp() + interval '1 day'", "null", "active", "clock_timestamp()", 1],
      ["rotated-token-hash-01", "clock_timestamp() + interval '1 day'", "null", "active", "null", 2],
    ] as const;

    for (const [caseIndex, [token, expiresAt, revokedAt, status, deletedAt, generation]] of cases.entries()) {
      const sessionId = `00000000-0000-4000-8000-${String(200 + caseIndex).padStart(12, "0")}`;
      await database.exec(`
        update public.students
        set status = '${status}', deleted_at = ${deletedAt}, code_generation = ${generation}
        where id = '${studentId}';
        insert into public.student_sessions (
          id, student_id, token_hash, code_generation, expires_at, last_seen_at, revoked_at
        ) values (
          '${sessionId}', '${studentId}', '${token}', 1,
          ${expiresAt}, clock_timestamp() - interval '25 hours', ${revokedAt}
        );
      `);
      const result = await database.query(`
        select * from public.renew_student_session_v2('${token}');
      `);
      expect(result.rows).toHaveLength(0);
      await database.exec(`
        truncate table public.student_sessions;
        update public.students
        set status = 'active', deleted_at = null, code_generation = 1
        where id = '${studentId}';
      `);
    }
  });

  it("브라우저 역할은 실행할 수 없고 서비스 역할만 실행할 수 있다", async () => {
    const privileges = await database.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      select
        has_function_privilege('anon', 'public.renew_student_session_v2(text)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.renew_student_session_v2(text)', 'execute') as authenticated,
        has_function_privilege('service_role', 'public.renew_student_session_v2(text)', 'execute') as service;
    `);
    expect(privileges.rows).toEqual([
      { anon: false, authenticated: false, service: true },
    ]);
  });

  it("실행 권한이 있어도 서비스 역할 claim이 아니면 거부한다", async () => {
    await database.exec(`
      select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
    `);
    await expect(
      database.query(`
        select * from public.renew_student_session_v2('claim-mismatch-token-0001');
      `),
    ).rejects.toThrow(/service_role required/);
  });
});
