import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730223000_persist_missed_assignments.sql",
  ),
  "utf8",
);

describe("missed assignment migration", () => {
  it("미응시 시각과 조회 인덱스를 영속화한다", () => {
    expect(migration).toContain(
      "add column missed_at timestamptz",
    );
    expect(migration).toContain(
      "assignment_students_pending_missed_idx",
    );
    expect(migration).toContain(
      "assignments_available_until_idx",
    );
    expect(migration).toContain(
      "assignment_students_missed_after_assignment",
    );
    expect(migration).toContain(
      "assignment_students_student_id_fkey",
    );
    expect(migration).toContain("on delete restrict");
  });

  it("응시 이력이 없는 마감 배정만 잠가 원자적으로 확정한다", () => {
    expect(migration).toContain(
      "public.finalize_missed_assignments(",
    );
    expect(migration).toContain(
      "assignment.available_until <= finalization_cutoff",
    );
    expect(migration).toContain("and not exists (");
    expect(migration).toContain(
      "from public.quiz_attempts as attempt",
    );
    expect(migration).toContain(
      "from public.students as student",
    );
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("limit p_limit");
    expect(migration).toContain(
      "set missed_at = current_deadline",
    );
    expect(migration).not.toContain("'backfilled'");
  });

  it("미응시 이후의 새 시도를 행 잠금으로 차단한다", () => {
    expect(migration).toContain(
      "private.reject_attempt_for_missed_assignment()",
    );
    expect(migration).toContain(
      "quiz_attempts_reject_missed_assignment",
    );
    expect(migration).toContain("for update;");
    expect(migration).toContain("assignment_not_owned");
    expect(migration).toContain("assignment_already_missed");
    expect(migration).toContain("assignment_unavailable");
  });

  it("미응시·응시 이력이 있는 배정 연결의 삭제를 막는다", () => {
    expect(migration).toContain(
      "private.reject_assignment_student_history_delete()",
    );
    expect(migration).toContain(
      "assignment_students_preserve_history",
    );
    expect(migration).toContain(
      "assignment_student_history_exists",
    );
  });

  it("감사 이력을 남기고 service role에만 확정 권한을 준다", () => {
    expect(migration).toContain("'assignment.missed'");
    expect(migration).not.toContain("'backfilled'");
    expect(migration).toContain(
      "from public, anon, authenticated",
    );
    expect(migration).toContain("to service_role");
  });
});
