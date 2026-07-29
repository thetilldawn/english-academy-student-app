import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730190000_create_exact_review_assignments.sql",
  ),
  "utf8",
);

describe("exact review assignment v4 migration", () => {
  it("active admin 전용 private/public RPC 경계를 유지한다", () => {
    expect(migration).toContain(
      "create function private.create_exact_review_assignment_v4(",
    );
    expect(migration).toContain(
      "create function public.create_exact_review_assignment_v4(",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "if not (select private.is_active_admin())",
    );
    expect(migration.match(/to authenticated, service_role;/g)).toHaveLength(
      2,
    );
  });

  it("student→queue→draft 순으로 잠그고 소진된 초안을 재사용하지 않는다", () => {
    const studentLock = migration.indexOf(
      "from public.students as student",
    );
    const queueLock = migration.indexOf(
      "from public.student_vocab_review_queue as queue\n  where queue.id = any(review_queue_ids)\n  order by queue.id\n  for update;",
    );
    const draftLock = migration.indexOf(
      "from public.student_vocab_review_assignment_drafts as draft\n  where draft.id = p_review_draft_id",
      queueLock,
    );
    expect(studentLock).toBeGreaterThan(-1);
    expect(queueLock).toBeGreaterThan(studentLock);
    expect(draftLock).toBeGreaterThan(queueLock);
    expect(migration).not.toContain("skip locked");
    expect(migration).toContain(
      "review_assignment_draft_unavailable",
    );
  });

  it("초안 순서와 정확히 같은 target 집합만 허용한다", () => {
    expect(migration).toContain(
      "question.base_order_index = item.position",
    );
    expect(migration).toContain(
      "question.vocab_entry_id = queue.vocab_entry_id",
    );
    expect(migration).toContain(
      "exact_review_target_order_mismatch",
    );
    expect(migration.match(/\n    except\n/g)).toHaveLength(2);
    expect(migration).toContain("exact_review_target_set_mismatch");
    expect(migration).toContain(
      "jsonb_array_length(p_questions) <> review_question_count",
    );
  });

  it("현재 canonical과 네 선택지 identity를 다시 검증한다", () => {
    expect(migration).toContain(
      "review_target_canonical_mapping_changed",
    );
    expect(migration).toContain(
      "count(distinct coalesce(",
    );
    expect(migration).toContain(
      "choice_eligibility.canonical_lexeme_id::text",
    );
    expect(migration).toContain(
      "identity_check.distinct_identity_count <> 4",
    );
    expect(migration).toContain(
      "review_choice_canonical_identity_not_distinct",
    );
  });

  it("target·선택지의 최소 연속 support scope로 검증된 v3를 호출한다", () => {
    expect(migration).toContain("with referenced_entry_ids as (");
    expect(migration).toContain(
      "unit.sort_index between first_scope_sort and last_scope_sort",
    );
    expect(migration).toContain(
      "review_question_support_scope_not_contiguous",
    );
    expect(migration).toContain(
      "private.create_assignment_with_question_bank_v3(",
    );
    expect(migration).toContain("array[draft_student_id]");
  });

  it("assignment 목적 변경·queue/draft 소비·감사를 한 트랜잭션에 둔다", () => {
    expect(migration).toContain(
      "set assignment_purpose = 'review'",
    );
    expect(migration).toContain("set is_primary = false");
    expect(migration).toContain("status = 'consumed'");
    expect(migration).toContain(
      "get diagnostics consumed_queue_count = row_count",
    );
    expect(migration).toContain(
      "get diagnostics consumed_draft_count = row_count",
    );
    expect(migration).toContain(
      "assignment_deadline_elapsed_during_review_creation",
    );
    expect(migration).toContain(
      "'assignment.review_queue_consumed'",
    );
  });
});
