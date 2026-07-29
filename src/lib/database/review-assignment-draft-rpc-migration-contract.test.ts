import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730180000_create_review_assignment_drafts.sql",
  ),
  "utf8",
);

describe("review assignment draft RPC migration", () => {
  it("인증 관리자만 private producer를 거쳐 초안을 만든다", () => {
    expect(migration).toContain(
      "create function private.create_student_vocab_review_assignment_draft(",
    );
    expect(migration).toContain(
      "create function public.create_student_vocab_review_assignment_draft(",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "if not (select private.is_active_admin())",
    );
    expect(migration).toContain(
      "private.queue_student_vocab_review_words(",
    );
  });

  it("학생→queue→draft 잠금과 단일 단어장 계약을 유지한다", () => {
    expect(migration).toContain("student.status = 'active'");
    expect(migration).toContain("order by queue.id\n  for update;");
    expect(migration).toContain(
      "count(distinct queue.dataset_id)",
    );
    expect(migration).toContain(
      "review_draft_requires_single_dataset",
    );
    expect(migration).not.toContain("skip locked");
  });

  it("만료 예약을 해제하고 같은 활성 선택은 초안 하나를 재사용한다", () => {
    expect(migration).toContain(
      "draft.expires_at <= clock_timestamp()",
    );
    expect(migration).toContain("status = 'expired'");
    expect(migration).toContain(
      "reserved_review_draft_id = null",
    );
    expect(migration).toContain(
      "active_draft_item_count = cardinality(queue_ids)",
    );
    expect(migration).toContain("return active_draft_id;");
    expect(migration).toContain(
      "review_queue_reserved_by_another_draft",
    );
  });

  it("예약·항목·감사를 같은 트랜잭션에 넣고 행 수를 재검증한다", () => {
    expect(migration).toContain(
      "reserved_review_draft_id = created_draft_id",
    );
    expect(migration).toContain(
      "get diagnostics updated_queue_count = row_count",
    );
    expect(migration).toContain(
      "review_draft_queue_reservation_race",
    );
    expect(migration).toContain(
      "insert into public.student_vocab_review_assignment_draft_items",
    );
    expect(migration).toContain(
      "review_draft_item_insert_mismatch",
    );
    expect(migration).toContain(
      "'student.review_assignment_draft.created'",
    );
  });

  it("테이블 직접 쓰기는 열지 않고 RPC 실행권한만 제한한다", () => {
    expect(migration).toContain(
      "from public, anon, authenticated;",
    );
    expect(migration).toContain("from public, anon;");
    expect(migration.match(/to authenticated, service_role;/g)).toHaveLength(
      2,
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on table/i,
    );
  });
});
