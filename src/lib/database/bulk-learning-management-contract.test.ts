import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260806221525_add_bulk_learning_management.sql",
  ),
  "utf8",
);
const examUseBulkMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808194824_fix_exam_use_bulk_assignments.sql",
  ),
  "utf8",
);

describe("일괄 배정과 학습 자료 DB 계약", () => {
  it("학습 자료 연결 테이블을 RLS와 명시적 권한으로 보호한다", () => {
    expect(migration).toContain(
      "create table public.student_learning_sources",
    );
    expect(migration).toContain(
      "alter table public.student_learning_sources enable row level security;",
    );
    expect(migration).toContain(
      "from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant select on table public.student_learning_sources to authenticated;",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:[^;]*\b)?(?:insert|update|delete)(?:\b[^;]*)?\s+on table public\.student_learning_sources to authenticated;/i,
    );
  });

  it("기존 주 단어장을 보존하고 이후 변경도 한 개의 활성 주 단어장으로 동기화한다", () => {
    expect(migration).toContain(
      "student_learning_sources_one_primary_idx",
    );
    expect(migration).toContain(
      "where source_type = 'primary_vocab' and active",
    );
    expect(migration).toContain(
      "student.current_vocab_dataset_id",
    );
    expect(migration).toContain(
      "create trigger students_sync_primary_learning_source",
    );
  });

  it("최대 30명의 배정을 한 RPC 안에서 만들고 중복 학생을 거절한다", () => {
    expect(migration).toContain(
      "create function private.create_bulk_vocab_assignments_v1(",
    );
    expect(migration).toContain(
      "jsonb_array_length(p_batches) not between 1 and 30",
    );
    expect(migration).toContain("duplicate_bulk_assignment_student");
    expect(migration).toContain(
      "private.create_assignment_with_delivery_v4(",
    );
    expect(migration).toContain(
      "private.create_mixed_review_assignment_v6(",
    );
    expect(migration).toContain("for update;");
  });

  it("브라우저에는 검증 래퍼만 열고 구현 함수의 익명 실행을 막는다", () => {
    expect(migration).toContain(
      "create function public.create_bulk_vocab_assignments_v1(",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "revoke all on function private.create_bulk_vocab_assignments_v1(jsonb)\n  from public, anon;",
    );
    expect(migration).toContain(
      "revoke all on function public.create_bulk_vocab_assignments_v1(jsonb)\n  from public, anon;",
    );
  });

  it("exam-use 단어장의 일반·오답 포함 일괄 배정을 최신 저장기로 분기한다", () => {
    expect(examUseBulkMigration).toContain(
      "create function private.create_bulk_vocab_assignments_v2(",
    );
    expect(examUseBulkMigration).toContain(
      "private.create_assignment_with_delivery_v5(",
    );
    expect(examUseBulkMigration).toContain(
      "private.create_mixed_review_assignment_v7(",
    );
    expect(examUseBulkMigration).toContain("p_review_scope text");
    expect(examUseBulkMigration).toContain(
      "exam_occurrence.exam_use_status = 'reviewed_for_preview'",
    );
    expect(examUseBulkMigration).toContain(
      "identity.dictionary_id = active.dictionary_id",
    );
    expect(examUseBulkMigration).toContain(
      "assignment_review_target_insert_mismatch",
    );
    expect(examUseBulkMigration).toContain("set search_path = ''");
    expect(examUseBulkMigration).toContain(
      "revoke all on function public.create_bulk_vocab_assignments_v2(jsonb)",
    );
  });
});
