import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730193000_finalize_expired_review_assignment_drafts.sql",
  ),
  "utf8",
);

describe("expired review assignment draft finalizer migration", () => {
  it("service role 전용 유지보수 RPC로 제한한다", () => {
    expect(migration).toContain(
      "create function public.finalize_expired_review_assignment_drafts(",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated;",
    );
    expect(migration).toContain("to service_role;");
  });

  it("student→queue→draft 순서로 잠근다", () => {
    const studentLock = migration.indexOf(
      "from public.students as student",
    );
    const queueLock = migration.indexOf(
      "from public.student_vocab_review_queue as queue",
    );
    const draftLock = migration.indexOf(
      "from public.student_vocab_review_assignment_drafts as draft",
      queueLock,
    );
    expect(studentLock).toBeGreaterThan(-1);
    expect(queueLock).toBeGreaterThan(studentLock);
    expect(draftLock).toBeGreaterThan(queueLock);
    expect(migration).not.toContain("skip locked");
  });

  it("기한이 지난 pending 초안만 만료시키고 예약을 해제한다", () => {
    expect(migration).toContain("draft.status = 'pending'");
    expect(migration).toContain(
      "draft.expires_at <= clock_timestamp()",
    );
    expect(migration).toContain("status = 'expired'");
    expect(migration).toContain(
      "reserved_review_draft_id = null",
    );
    expect(migration).toContain("reserved_at = null");
  });

  it("처리한 초안 집합을 감사 기록에 남긴다", () => {
    expect(migration).toContain(
      "'student.review_assignment_drafts.expired'",
    );
    expect(migration).toContain("'draftCount'");
    expect(migration).toContain("'draftIds'");
  });
});
