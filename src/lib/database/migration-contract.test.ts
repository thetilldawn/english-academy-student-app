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
const studentProfileMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728213110_add_student_current_vocab_book.sql",
  ),
  "utf8",
);
const studentDatasetMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728222713_student_vocab_dataset_selection.sql",
  ),
  "utf8",
);
const studentDatasetEnforcementMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728223531_enforce_student_vocab_dataset_selection.sql",
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

  it("현재 단어장을 nullable 프로필 값으로 저장하고 새 RPC로 받는다", () => {
    expect(studentProfileMigration).toContain(
      "add column current_vocab_book text",
    );
    expect(studentProfileMigration).toContain(
      "students_current_vocab_book_length_check",
    );
    expect(studentProfileMigration).toContain(
      "or char_length(trim(current_vocab_book)) between 1 and 160",
    );
    expect(
      studentProfileMigration.match(
        /create function (?:private|public)\.create_student_with_code\(/g,
      ),
    ).toHaveLength(2);
    expect(
      studentProfileMigration.match(/p_current_vocab_book text/g),
    ).toHaveLength(2);
    expect(studentProfileMigration).toContain(
      "nullif(trim(p_current_vocab_book), '')",
    );
    expect(studentProfileMigration).toContain("security invoker");
    expect(studentProfileMigration).toContain(
      "from public, anon;",
    );
  });

  it("현재 단어장을 검수 완료 데이터셋 FK로 선택하고 v2 RPC에서 재검증한다", () => {
    expect(studentDatasetMigration).toContain(
      "add column current_vocab_dataset_id uuid",
    );
    expect(studentDatasetMigration).toContain(
      "constraint students_current_vocab_dataset_id_fkey",
    );
    expect(studentDatasetMigration).toContain("on delete restrict");
    expect(studentDatasetMigration).toContain(
      "create index students_current_vocab_dataset_idx",
    );
    expect(
      studentDatasetMigration.match(
        /create function (?:private|public)\.create_student_with_code_v2\(/g,
      ),
    ).toHaveLength(2);
    expect(
      studentDatasetMigration.match(
        /p_current_vocab_dataset_id uuid/g,
      ),
    ).toHaveLength(2);
    expect(studentDatasetMigration).toContain("status = 'ready'");
    expect(studentDatasetMigration).toContain("and is_active");
    expect(studentDatasetMigration).toContain(
      "raise exception 'dataset_required'",
    );
    expect(studentDatasetMigration).toContain(
      "raise exception 'dataset_not_ready'",
    );
    expect(studentDatasetMigration).toContain("security invoker");
    expect(studentDatasetMigration).toContain(
      "from public, anon;",
    );
  });

  it("구형 생성 경로를 닫고 현재 단어장 선택을 DB 필수값으로 만든다", () => {
    expect(studentDatasetEnforcementMigration).toContain(
      "students_without_current_vocab_dataset",
    );
    expect(studentDatasetEnforcementMigration).toContain(
      "alter column current_vocab_dataset_id set not null",
    );
    expect(
      studentDatasetEnforcementMigration.match(
        /drop function public\.create_student_with_code\(/g,
      ),
    ).toHaveLength(2);
    expect(
      studentDatasetEnforcementMigration.match(
        /drop function private\.create_student_with_code\(/g,
      ),
    ).toHaveLength(2);
  });
});
