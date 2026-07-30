import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730234500_record_initial_wrongs_and_cancel_review_drafts.sql",
  ),
  "utf8",
);

describe("initial wrong recording and review draft cancellation migration", () => {
  it("records initial wrong answers at the review transition and backfills existing reviews", () => {
    expect(migration).toContain(
      "create trigger quiz_attempts_record_initial_wrong_events",
    );
    expect(migration).toContain("after update of phase");
    expect(migration).toContain("old.phase = 'initial'");
    expect(migration).toContain("new.phase = 'review'");
    expect(migration).toContain("new.status = 'in_progress'");
    expect(migration).toContain(
      "private.record_wrong_events_for_attempt(",
    );
    expect(migration).toContain(
      "coalesce(new.initial_completed_at, clock_timestamp())",
    );
    expect(migration).toContain(
      "attempt.phase = 'review'",
    );
    expect(migration).toContain(
      "attempt.initial_completed_at is not null",
    );
  });

  it("cancels pending drafts with the established student to queue to draft lock order", () => {
    const functionStart = migration.indexOf(
      "create function private.cancel_student_vocab_review_assignment_draft(",
    );
    const studentLock = migration.indexOf(
      "from public.students as student",
      functionStart,
    );
    const queueLock = migration.indexOf(
      "from public.student_vocab_review_queue as queue",
      studentLock,
    );
    const draftLock = migration.indexOf(
      "from public.student_vocab_review_assignment_drafts as draft",
      queueLock,
    );

    expect(functionStart).toBeGreaterThan(-1);
    expect(studentLock).toBeGreaterThan(functionStart);
    expect(queueLock).toBeGreaterThan(studentLock);
    expect(draftLock).toBeGreaterThan(queueLock);
    expect(migration).toContain("draft_status = 'cancelled'");
    expect(migration).toContain("draft_status <> 'pending'");
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain("cancelled_at = clock_timestamp()");
  });

  it("releases only the reservation and keeps queue rows pending", () => {
    expect(migration).toContain(
      "reserved_review_draft_id = null",
    );
    expect(migration).toContain("reserved_at = null");
    expect(migration).toContain("queue.status = 'pending'");
    expect(migration).toContain(
      "'student.review_assignment_draft.cancelled'",
    );
    expect(migration).toContain(
      "'queueDisposition', 'pending'",
    );
    expect(migration).not.toContain(
      "delete from public.student_vocab_review_queue",
    );
  });

  it("keeps the public RPC authenticated and hardens definer search paths", () => {
    expect(migration).toContain(
      "create function public.cancel_student_vocab_review_assignment_draft(",
    );
    expect(migration).toContain("security invoker");
    expect(migration.match(/set search_path = ''/g)?.length).toBe(3);
    expect(migration).toContain(
      "from public, anon;",
    );
    expect(migration).toContain(
      "to authenticated, service_role;",
    );
  });
});
