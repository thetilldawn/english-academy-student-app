import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730173000_allow_small_exact_review_assignments.sql",
  ),
  "utf8",
);

describe("small exact review assignment migration", () => {
  it("배정과 응시 문항 수만 1~500으로 완화하고 검증한다", () => {
    expect(migration).toContain(
      "drop constraint assignments_question_count_check",
    );
    expect(migration).toContain(
      "check (question_count between 1 and 500)",
    );
    expect(migration).toContain(
      "validate constraint assignments_question_count_check",
    );
    expect(migration).toContain(
      "drop constraint quiz_attempts_question_count_snapshot_check",
    );
    expect(migration).toContain(
      "check (question_count_snapshot between 1 and 500)",
    );
    expect(migration).toContain(
      "validate constraint quiz_attempts_question_count_snapshot_check",
    );
    expect(migration.match(/\n  not valid;/g)).toHaveLength(2);
  });

  it("기존 제약이 예상한 4~500 계약일 때만 변경한다", () => {
    expect(migration).toContain(
      "unexpected_assignments_question_count_constraint",
    );
    expect(migration).toContain(
      "unexpected_attempt_question_count_constraint",
    );
    expect(migration).toContain(
      "pg_get_constraintdef(constraint_row.oid)",
    );
  });

  it("검토된 private base와 v2의 하한 한 곳씩만 fail-closed로 바꾼다", () => {
    expect(migration).toContain(
      "private.create_assignment_with_question_bank(",
    );
    expect(migration).toContain(
      "private.create_assignment_with_question_bank_v2(",
    );
    expect(migration).toContain(
      "'p_question_count not between 4 and 500'",
    );
    expect(migration).toContain(
      "'p_question_count not between 1 and 500'",
    );
    expect(migration).toContain("occurrence_count <> 1");
    expect(migration).toContain(
      "unexpected_review_assignment_core_definition",
    );
    expect(migration).toContain("execute replace(");
  });

  it("공개 레거시 생성 함수나 4지선다 검증은 건드리지 않는다", () => {
    expect(migration).not.toContain(
      "public.create_assignment_with_question_bank(",
    );
    expect(migration).not.toContain(
      "cardinality(question.choice_vocab_entry_ids)",
    );
    expect(migration).not.toContain("choice_count");
  });
});
