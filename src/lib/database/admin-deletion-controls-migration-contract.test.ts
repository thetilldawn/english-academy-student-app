import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260731010000_admin_deletion_controls.sql",
  ),
  "utf8",
);
const rollback = fs.readFileSync(
  path.resolve(
    "supabase/rollback/20260731010000_admin_deletion_controls.sql",
  ),
  "utf8",
);
const targetedDeletionMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260826001650_add_targeted_admin_deletion_commands.sql",
  ),
  "utf8",
);

describe("admin deletion controls migration", () => {
  it("학생과 시험은 이력을 보존하는 삭제 상태로 전환한다", () => {
    expect(migration).toContain(
      "create function private.delete_student_v1(",
    );
    expect(migration).toContain(
      "create function private.delete_assignment_v1(",
    );
    expect(migration).toContain("set\n    status = 'blocked'");
    expect(migration).toContain("set\n    status = 'closed'");
    expect(migration).toContain("delete from public.student_codes");
    expect(migration).toContain("student_deleted");
    expect(migration).toContain("assignment_deleted");
    expect(migration).toContain(
      "private.abandon_student_attempt_v1",
    );
    expect(migration).not.toContain("delete from public.quiz_attempts");
  });

  it("내역 숨김은 원본 FK와 감사 기록을 보존한다", () => {
    expect(migration).toContain(
      "create table public.admin_history_hidden_entries",
    );
    expect(migration).toContain(
      "references public.quiz_attempts(id)",
    );
    expect(migration).toContain("on delete restrict");
    expect(migration).toContain(
      "create policy \"active admins read hidden history entries\"",
    );
    expect(migration).toContain("'admin.history.hidden'");
    expect(migration).toContain("get diagnostics inserted_count");
    expect(migration).toContain("history_entry_stale");
  });

  it("삭제 학생·시험의 새 응시와 재배정을 DB에서도 막는다", () => {
    expect(migration).toContain(
      "assignment_students_reject_deleted_recipient",
    );
    expect(migration).toContain("students_reject_physical_delete");
    expect(migration).toContain(
      "assignments_reject_physical_delete",
    );
    expect(migration).toContain(
      "create or replace function private.reject_attempt_for_missed_assignment()",
    );
    expect(migration).toContain("assignment_deleted_at");
    expect(migration).toContain("student_deleted_at");
    expect(migration).toContain("old.cancelled_at is not null");
  });

  it("공개 RPC 권한을 명시하고 활동이 생긴 뒤 롤백을 막는다", () => {
    expect(migration).toContain(
      "grant execute on function public.delete_student_v1(uuid)",
    );
    expect(migration).toContain(
      "grant execute on function public.delete_assignment_v1(uuid, text)",
    );
    expect(migration).toContain(
      "grant execute on function public.hide_admin_history_entry_v1(uuid, uuid, uuid)",
    );
    expect(rollback).toContain(
      "admin_deletion_controls_rollback_has_activity",
    );
    expect(rollback).toContain(
      "where deleted_at is not null",
    );
    expect(migration).toMatch(/^begin;/);
    expect(migration).toContain("notify pgrst, 'reload schema';");
    expect(rollback).toContain("notify pgrst, 'reload schema';");
  });

  it("대상 학생과 시험만 고정 시각으로 정리한 뒤 삭제한다", () => {
    const service = fs.readFileSync(
      path.resolve("src/lib/services/admin-deletion-service.ts"),
      "utf8",
    );
    expect(targetedDeletionMigration).toContain(
      "create function private.delete_student_v2(",
    );
    expect(targetedDeletionMigration).toContain(
      "create function private.delete_assignment_v2(",
    );
    expect(targetedDeletionMigration).toContain(
      "evaluation_at timestamptz := transaction_timestamp()",
    );
    expect(targetedDeletionMigration).toContain(
      "private.finalize_expired_quiz_attempt_at_v2(",
    );
    expect(targetedDeletionMigration).not.toContain(
      "finalize_stale_quiz_attempts",
    );
    expect(targetedDeletionMigration).toContain(
      "where retry.student_id = p_student_id",
    );
    expect(targetedDeletionMigration).toContain(
      "jsonb_build_object('reason', 'student_deleted')",
    );
    const attemptLockIndex = targetedDeletionMigration.indexOf(
      "perform attempt.id",
    );
    const seriesLockIndex = targetedDeletionMigration.indexOf(
      "for series_row in",
    );
    const attemptFinalizeIndex = targetedDeletionMigration.indexOf(
      "for attempt_row in",
    );
    const baseDeleteIndex = targetedDeletionMigration.indexOf(
      "base_result := private.delete_student_v1(p_student_id)",
    );
    expect(attemptLockIndex).toBeGreaterThan(-1);
    expect(attemptLockIndex).toBeLessThan(seriesLockIndex);
    expect(seriesLockIndex).toBeLessThan(attemptFinalizeIndex);
    expect(attemptFinalizeIndex).toBeLessThan(baseDeleteIndex);
    expect(targetedDeletionMigration).toContain(
      "grant execute on function public.delete_student_v2(uuid)",
    );
    expect(targetedDeletionMigration).toContain(
      "grant execute on function public.delete_assignment_v2(uuid, text)",
    );
    expect(service).toContain('supabase.rpc("delete_student_v2"');
    expect(service).toContain('supabase.rpc("delete_assignment_v2"');
  });
});
