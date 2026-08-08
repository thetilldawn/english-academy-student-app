import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808180535_add_notification_receipts_and_rolling_sessions.sql",
  ),
  "utf8",
);

describe("알림 수령 기록과 rolling 학생 세션 DB 계약", () => {
  it("브라우저 직접 접근을 막고 서비스 역할만 허용한다", () => {
    expect(migration).toContain(
      "alter table public.notification_receipts enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.notification_receipts\n  from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant select, insert on table public.notification_receipts to service_role;",
    );
    expect(migration).not.toMatch(
      /grant[^;]+notification_receipts[^;]+(?:anon|authenticated)/i,
    );
  });

  it("알림 원본과 마감 버전을 복합 기본키로 중복 차단한다", () => {
    expect(migration).toContain("notification_type,");
    expect(migration).toContain("deadline_version");
    expect(migration.match(/on conflict do nothing/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("returning 1");
  });

  it("학생 마감 알림은 8시간 이내이며 변경된 마감을 새 버전으로 본다", () => {
    expect(migration).toContain(
      "assignment.available_until <= clock_timestamp() + interval '8 hours'",
    );
    expect(migration).toContain("assignment.available_until\n    from");
    expect(migration).toContain("assignment_link.cancelled_at is null");
    expect(migration).toContain("assignment.deleted_at is null");
  });

  it("관리자 본인 배정은 배정 트랜잭션에서 즉시 수령 처리한다", () => {
    expect(migration).toContain(
      "create trigger assignment_students_acknowledge_assigning_admin_notification",
    );
    expect(migration).toContain("new.assigned_by");
    expect(migration).toContain("after insert on public.assignment_students");
  });

  it("유효한 학생 세션만 마지막 접속부터 60일 연장한다", () => {
    expect(migration).toContain(
      "create or replace function public.refresh_student_session_v1(",
    );
    expect(migration).toContain(
      "expires_at = clock_timestamp() + interval '60 days'",
    );
    expect(migration).toContain("session.revoked_at is null");
    expect(migration).toContain("session.expires_at > clock_timestamp()");
    expect(migration).toContain(
      "student.code_generation = session.code_generation",
    );
  });
});
