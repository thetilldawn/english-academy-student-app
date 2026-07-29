import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260728162905_initial_student_app_mvp.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const hardeningMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728163337_harden_admin_rpc_wrappers.sql",
  ),
  "utf8",
);
const studentProfileMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728213700_add_student_current_vocab_book.sql",
  ),
  "utf8",
);
const studentDatasetMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728223108_student_vocab_dataset_selection.sql",
  ),
  "utf8",
);
const studentDatasetEnforcementMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260728224138_enforce_student_vocab_dataset_selection.sql",
  ),
  "utf8",
);
const cachedDayAssignmentMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729005637_add_cached_day_assignment_flow.sql",
  ),
  "utf8",
);
const studentVocabManagementMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729012405_manage_student_vocab_dataset.sql",
  ),
  "utf8",
);
const explicitRetryReviewMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729153508_add_explicit_quiz_retry_review_phase.sql",
  ),
  "utf8",
);
const assignmentDeadlineMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730103000_add_assignment_deadlines_and_stale_finalizer.sql",
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

  it("구형 생성 경로를 닫았던 과거 필수화 이력을 유지한다", () => {
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

  it("현재 단어장을 다시 선택 사항으로 열고 준비된 데이터셋은 검증한다", () => {
    expect(cachedDayAssignmentMigration).toContain(
      "alter column current_vocab_dataset_id drop not null",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "if p_current_vocab_dataset_id is not null then",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "raise exception 'dataset_not_ready'",
    );
  });

  it("DAY와 배정 문제은행에 RLS·외래키·순서 제약을 둔다", () => {
    for (const table of [
      "vocab_units",
      "assignment_units",
      "assignment_questions",
    ]) {
      expect(cachedDayAssignmentMigration).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(cachedDayAssignmentMigration).toContain(
        `grant all on table public.${table} to service_role;`,
      );
    }
    expect(cachedDayAssignmentMigration).toContain(
      "unique (assignment_id, base_order_index)",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "unique (assignment_id, vocab_entry_id)",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "quiz_questions_attempt_bank_question_unique",
    );
  });

  it("문제은행 시도는 문항을 재생성하지 않고 순서만 저장한다", () => {
    expect(cachedDayAssignmentMigration).toContain(
      "create function public.create_quiz_attempt_from_bank(",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "from public.assignment_questions as question",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "assignment_row.question_order_mode = 'random'",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "'nextQuestionId', next_question_id",
    );
    expect(cachedDayAssignmentMigration).toContain(
      "'nextPhase', next_phase",
    );
  });

  it("현재 단어장은 관리자 RPC로만 변경하고 준비 상태를 재검증한다", () => {
    expect(studentVocabManagementMigration).toContain(
      "create function private.set_student_current_vocab_dataset(",
    );
    expect(studentVocabManagementMigration).toContain(
      "create function public.set_student_current_vocab_dataset(",
    );
    expect(studentVocabManagementMigration).toContain(
      "status = 'ready'",
    );
    expect(studentVocabManagementMigration).toContain("and is_active");
    expect(studentVocabManagementMigration).toContain("security invoker");
    expect(studentVocabManagementMigration).toContain(
      "from public, anon;",
    );
  });

  it("첫 시험 결과 검토 뒤에만 별도 제한시간으로 재시험을 연다", () => {
    expect(explicitRetryReviewMigration).toContain(
      "create type public.attempt_phase as enum",
    );
    expect(explicitRetryReviewMigration).toContain(
      "'initial',\n  'review',\n  'retry',\n  'completed'",
    );
    expect(explicitRetryReviewMigration).toContain(
      "create function public.start_quiz_retry(",
    );
    expect(explicitRetryReviewMigration).toContain(
      "attempt_row.phase <> 'review'",
    );
    expect(explicitRetryReviewMigration).toContain(
      "retry_deadline := retry_start_time",
    );
    expect(explicitRetryReviewMigration).toContain(
      "'needsRetry', review_required",
    );
    expect(explicitRetryReviewMigration).toContain(
      "deadline_at = 'infinity'::timestamptz",
    );
    expect(explicitRetryReviewMigration).toContain(
      "initial_correct_count = initial_correct",
    );
    expect(explicitRetryReviewMigration).toContain(
      "unresolved_wrong_count = initial_wrong - retry_correct",
    );
    expect(explicitRetryReviewMigration).toContain(
      "attempt_row.phase = 'review'",
    );
    expect(explicitRetryReviewMigration).toContain(
      "from public, anon, authenticated;",
    );
    expect(explicitRetryReviewMigration).toContain(
      ") to service_role;",
    );
    expect(explicitRetryReviewMigration).not.toContain(
      "security definer",
    );
  });

  it("마감 시험을 제한 배치와 건별 경로에서 확정하고 API 스키마를 갱신한다", () => {
    expect(assignmentDeadlineMigration).toContain(
      "create function public.finalize_stale_quiz_attempts(",
    );
    expect(assignmentDeadlineMigration).toContain(
      "for update skip locked",
    );
    expect(assignmentDeadlineMigration).toContain(
      "create function public.finalize_quiz_attempt_if_stale(",
    );
    expect(assignmentDeadlineMigration).toContain(
      "grant execute on function public.finalize_quiz_attempt_if_stale(uuid)",
    );
    expect(assignmentDeadlineMigration).toContain(
      "notify pgrst, 'reload schema'",
    );
  });
});
