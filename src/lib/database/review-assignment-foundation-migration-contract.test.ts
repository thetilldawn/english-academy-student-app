import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730170000_add_review_assignment_foundation.sql",
  ),
  "utf8",
);

describe("review assignment foundation migration", () => {
  it("일반·오답·혼합 배정을 구분하고 주 DAY만 표시한다", () => {
    expect(migration).toContain(
      "add column assignment_purpose text not null default 'regular'",
    );
    expect(migration).toContain(
      "assignment_purpose in ('regular', 'review', 'mixed')",
    );
    expect(migration).toContain(
      "add column is_primary boolean not null default true",
    );
    expect(migration).toContain(
      "assignment_units_primary_position_idx",
    );
  });

  it("재시험 선택을 서버측 초안과 순서 있는 항목으로 보존한다", () => {
    expect(migration).toContain(
      "create table public.student_vocab_review_assignment_drafts",
    );
    expect(migration).toContain(
      "create table public.student_vocab_review_assignment_draft_items",
    );
    expect(migration).toContain(
      "status in ('pending', 'consumed', 'cancelled', 'expired')",
    );
    expect(migration).toContain(
      "student_vocab_review_assignment_drafts_state_check",
    );
    expect(migration).toContain(
      "student_vocab_review_assignment_drafts_expiry_check",
    );
    expect(migration).toContain("unique (draft_id, position)");
  });

  it("대기 단어 하나를 활성 초안 하나에만 예약 가능한 상태로 만든다", () => {
    expect(migration).toContain(
      "add column reserved_review_draft_id uuid",
    );
    expect(migration).toContain("add column reserved_at timestamptz");
    expect(migration).toContain(
      "reserved_review_draft_id is not null",
    );
    expect(migration).toContain(
      "student_vocab_review_queue_reserved_draft_idx",
    );
    expect(migration).toContain(
      "drop constraint student_vocab_review_queue_state_check",
    );
    expect(migration).toContain(
      "validate constraint student_vocab_review_queue_state_check",
    );
    expect(migration).toContain(
      "create function private.enforce_review_assignment_draft_item()",
    );
    expect(migration).toContain(
      "queue.reserved_review_draft_id = draft.id",
    );
    expect(migration).toContain(
      "queue.student_id = draft.student_id",
    );
    expect(migration).toContain(
      "queue.dataset_id = draft.dataset_id",
    );
  });

  it("배정 목적과 주 DAY의 모순을 commit 전에 차단한다", () => {
    expect(migration).toContain(
      "create function private.enforce_assignment_unit_purpose_consistency()",
    );
    expect(migration).toContain(
      "create constraint trigger assignments_unit_purpose_consistency",
    );
    expect(migration).toContain(
      "create constraint trigger assignment_units_purpose_consistency",
    );
    expect(migration.match(/deferrable initially deferred/g)).toHaveLength(
      2,
    );
    expect(migration).toContain(
      "purpose = 'review'\n      and primary_unit_count <> 0",
    );
    expect(migration).toContain(
      "purpose = 'mixed'\n      and primary_unit_count = 0",
    );
    expect(migration).toContain(
      "raise exception 'assignment_unit_purpose_mismatch'",
    );
    expect(migration).toContain(
      "create function private.prevent_assignment_unit_reparenting()",
    );
    expect(migration).toContain(
      "new.assignment_id is distinct from old.assignment_id",
    );
    expect(migration).toContain(
      "create trigger assignment_units_prevent_reparenting",
    );
  });

  it("초안 테이블은 관리자 읽기만 열고 직접 쓰기를 막는다", () => {
    for (const table of [
      "student_vocab_review_assignment_drafts",
      "student_vocab_review_assignment_draft_items",
    ]) {
      expect(migration).toContain(
        `alter table public.${table}\n  enable row level security;`,
      );
      expect(migration).toContain(
        `revoke all on table public.${table}`,
      );
      expect(migration).toContain(
        `grant select on table public.${table}`,
      );
      expect(migration).toContain(
        `grant all on table public.${table}\n  to service_role;`,
      );
    }
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on table public\.student_vocab_review_assignment_[^\s]+\s+to authenticated/i,
    );
  });
});
