import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730203000_create_mixed_review_assignments.sql",
  ),
  "utf8",
);

describe("mixed review assignment migration", () => {
  it("exact와 mixed가 같은 검증·저장 core를 사용한다", () => {
    expect(migration).toContain(
      "create function private.persist_review_assignment_v5(",
    );
    expect(migration).toContain(
      "create or replace function private.create_exact_review_assignment_v4(",
    );
    expect(migration).toContain(
      "return private.persist_review_assignment_v5(",
    );
    expect(migration).toContain(
      "created_assignment_id := private.persist_review_assignment_v5(",
    );
  });

  it("학생 잠금 뒤 동일 우선순위 top-N을 다시 계산한다", () => {
    const mixedFunctionStart = migration.indexOf(
      "create function private.create_mixed_review_assignment_v5(",
    );
    const mixedFunction = migration.slice(mixedFunctionStart);
    const studentLock = mixedFunction.indexOf("for update;");
    const topNSelection = mixedFunction.indexOf(
      "and queue.status = 'pending'",
    );
    const snapshotComparison = mixedFunction.indexOf(
      "current_queue_ids is distinct from p_selected_queue_ids",
    );

    expect(mixedFunctionStart).toBeGreaterThanOrEqual(0);
    expect(studentLock).toBeGreaterThanOrEqual(0);
    expect(topNSelection).toBeGreaterThan(studentLock);
    expect(snapshotComparison).toBeGreaterThan(topNSelection);
    expect(mixedFunction).toContain(
      "and queue.reserved_review_draft_id is null",
    );
    expect(mixedFunction).toContain(
      "and queue.reason_level = any(p_review_levels)",
    );
    expect(mixedFunction).toContain("queue.reason_level desc");
    expect(mixedFunction).toContain("queue.queued_at");
    expect(mixedFunction).toContain("queue.id");
    expect(mixedFunction).toContain("limit p_review_limit");
    expect(mixedFunction).toContain(
      "raise exception 'mixed_review_queue_snapshot_changed'",
    );
  });

  it("review target과 새 DAY target의 역할을 DB에서 검증한다", () => {
    expect(migration).toContain(
      "raise exception 'review_target_order_mismatch'",
    );
    expect(migration).toContain(
      "raise exception 'review_target_set_mismatch'",
    );
    expect(migration).toContain(
      "raise exception 'mixed_regular_target_outside_primary_units'",
    );
    expect(migration).toContain(
      "raise exception 'mixed_primary_units_invalid'",
    );
    expect(migration).toContain(
      "raise exception 'mixed_regular_target_already_pending_review'",
    );
    expect(migration).toContain(
      "pending_queue.canonical_lexeme_id_snapshot",
    );
    expect(migration).toContain(
      "review_question_count >= total_question_count",
    );
  });

  it("지원 범위와 주 DAY를 분리하고 queue를 원자적으로 소비한다", () => {
    expect(migration).toContain(
      "private.create_assignment_with_question_bank_v3(",
    );
    expect(migration).toContain(
      "set assignment_purpose = derived_assignment_purpose",
    );
    expect(migration).toContain(
      "then assignment_unit.unit_id = any(p_primary_unit_ids)",
    );
    expect(migration).toContain("status = 'consumed'");
    expect(migration).toContain(
      "raise exception 'review_queue_consume_mismatch'",
    );
    expect(migration).toContain(
      "'assignment.review_queue_consumed'",
    );
    expect(migration).toContain(
      "'assignment.mixed_review_selected'",
    );
  });

  it("canonical choice와 권한 경계를 유지한다", () => {
    expect(migration).toContain(
      "raise exception 'review_choice_canonical_identity_not_distinct'",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "revoke all on function private.persist_review_assignment_v5(",
    );
    expect(migration).toContain(
      "grant execute on function public.create_mixed_review_assignment_v5(",
    );
    expect(migration).toContain(
      "to authenticated, service_role;",
    );
  });
});
