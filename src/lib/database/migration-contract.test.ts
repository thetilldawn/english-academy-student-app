import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260728134932_initial_student_app_mvp.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const hardeningMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728170000_harden_admin_rpc_wrappers.sql",
  ),
  "utf8",
);
const config = fs.readFileSync(
  path.resolve("supabase/config.toml"),
  "utf8",
);

describe("database security contract", () => {
  it("모든 공개 테이블에 RLS를 켠다", () => {
    const tables = [
      "admin_profiles",
      "students",
      "student_codes",
      "student_sessions",
      "student_login_attempts",
      "vocab_datasets",
      "vocab_entries",
      "assignments",
      "assignment_students",
      "quiz_attempts",
      "quiz_questions",
      "student_vocab_state",
      "audit_events",
    ];

    for (const table of tables) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("브라우저 관리자에게 테이블 직접 쓰기 권한을 주지 않는다", () => {
    expect(migration).toContain(
      "grant select on all tables in schema public to authenticated;",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:[^;]*\b)?(?:insert|update|delete)(?:\b[^;]*)?\s+to authenticated;/i,
    );
  });

  it("관리자 쓰기 RPC의 권한상승 구현을 비공개 스키마에 둔다", () => {
    const functions = [
      "create_student_with_code",
      "rotate_student_code",
      "set_student_access_status",
      "create_assignment_with_students",
    ];

    for (const functionName of functions) {
      expect(hardeningMigration).toContain(
        `alter function public.${functionName}(`,
      );
      expect(hardeningMigration).toContain(
        `create function public.${functionName}(`,
      );
      expect(hardeningMigration).toContain(
        `private.${functionName}(`,
      );
    }

    expect(hardeningMigration.match(/security invoker/g)).toHaveLength(4);
    expect(hardeningMigration).not.toContain("security definer");
  });

  it("로그인 제한·한 시험 한 진행상태·만료 확정 가드를 유지한다", () => {
    expect(migration).toContain(
      "create function public.consume_student_login_attempt(",
    );
    expect(migration).toContain(
      "create unique index quiz_attempts_one_in_progress_idx",
    );
    expect(migration).toContain(
      "create function private.finalize_expired_quiz_attempt(",
    );
    expect(migration).toContain(
      "constraint quiz_attempts_state_consistency check",
    );
  });

  it("배정 학생 삽입 열과 주요 외래키 인덱스를 유지한다", () => {
    expect(migration).toContain(
      "insert into public.assignment_students (\n    assignment_id,\n    student_id,\n    assigned_by",
    );

    const indexes = [
      "students_created_by_idx",
      "vocab_datasets_imported_by_idx",
      "assignments_dataset_idx",
      "assignments_created_by_idx",
      "assignment_students_assigned_by_idx",
      "quiz_attempts_assignment_idx",
      "quiz_questions_vocab_entry_idx",
      "student_vocab_state_vocab_entry_idx",
      "student_vocab_state_last_attempt_idx",
      "audit_events_actor_admin_time_idx",
    ];

    for (const index of indexes) {
      expect(migration).toContain(`create index ${index}`);
    }
  });

  it("로컬 Supabase 공개 회원가입을 끈다", () => {
    expect(config.match(/enable_signup = false/g)).toHaveLength(3);
    expect(config).not.toContain("enable_signup = true");
  });
});
