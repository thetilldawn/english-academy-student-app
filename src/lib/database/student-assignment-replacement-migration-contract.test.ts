import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const baseMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260807221021_replace_student_assignment_v1.sql",
  ),
  "utf8",
);
const hardeningMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260807225140_harden_student_assignment_replacement_v2.sql",
  ),
  "utf8",
);

describe("student assignment replacement migration contract", () => {
  it("private ledger와 명시적 함수 권한을 둔다", () => {
    expect(baseMigration).toContain(
      "create table private.assignment_replacement_requests",
    );
    expect(baseMigration).toContain("idempotency_key uuid primary key");
    expect(baseMigration).toContain("request_sha256 text not null");
    expect(baseMigration).toContain(
      "revoke all on table private.assignment_replacement_requests",
    );
    expect(hardeningMigration).toContain(
      "add column payload_sha256 text",
    );
    expect(hardeningMigration).toContain(
      "create function public.replace_student_assignment_v2(",
    );
    expect(baseMigration).toContain(
      "create function public.get_student_assignment_replacement_result_v1(",
    );
    expect(hardeningMigration).toContain("from public, anon;");
    expect(hardeningMigration).toContain(
      "to authenticated, service_role;",
    );
    expect(hardeningMigration).toContain(
      "from public, anon, authenticated, service_role;",
    );
  });

  it("학생 우선 잠금 뒤 원본 link를 잠그고 상태를 모두 재검증한다", () => {
    const studentLock = hardeningMigration.indexOf(
      "from public.students as student\n  where student.id = p_student_id\n  for update;",
    );
    const ledgerLock = hardeningMigration.indexOf(
      "where request.idempotency_key = p_idempotency_key\n  for update;",
    );
    const sourceLock = hardeningMigration.indexOf(
      "for update of assignment, link;",
    );
    expect(studentLock).toBeGreaterThan(-1);
    expect(ledgerLock).toBeGreaterThan(studentLock);
    expect(sourceLock).toBeGreaterThan(ledgerLock);
    for (const reason of [
      "assignment_deleted",
      "assignment_not_active",
      "assignment_already_cancelled",
      "assignment_already_missed",
      "assignment_deadline_elapsed",
      "assignment_already_completed",
      "assignment_already_started",
    ]) {
      expect(hardeningMigration).toContain(reason);
    }
  });

  it("한 transaction에서 원본 취소 후 목적별 snapshot을 만들고 이전·이후를 감사한다", () => {
    const cancel = hardeningMigration.indexOf(
      "perform private.cancel_student_assignment_v1(",
    );
    const regular = hardeningMigration.indexOf(
      "private.create_assignment_with_delivery_v5(",
    );
    const mixed = hardeningMigration.indexOf(
      "private.persist_review_assignment_v5(",
    );
    const exactReview = hardeningMigration.indexOf(
      "private.create_exact_review_assignment_v4(",
    );
    expect(hardeningMigration).toContain("begin;");
    expect(hardeningMigration).toContain("commit;");
    expect(cancel).toBeGreaterThan(-1);
    expect(regular).toBeGreaterThan(cancel);
    expect(mixed).toBeGreaterThan(cancel);
    expect(exactReview).toBeGreaterThan(cancel);
    expect(hardeningMigration).toContain("assignment.student.replaced");
    expect(hardeningMigration).toContain("'before', jsonb_build_object(");
    expect(hardeningMigration).toContain("'after', jsonb_build_object(");
    expect(hardeningMigration).toContain("'reviewQueueIds'");
    expect(hardeningMigration).toContain("'questionBankSha256'");
  });

  it("caller hash와 별도로 실제 payload hash를 검증하고 exact review 1문항을 허용한다", () => {
    expect(hardeningMigration).toContain(
      "request_row.payload_sha256 <> computed_payload_sha256",
    );
    expect(hardeningMigration).toContain(
      "p_replacement_kind not in ('regular', 'mixed', 'review')",
    );
    expect(hardeningMigration).toContain(
      "p_replacement_kind = 'regular'",
    );
    expect(hardeningMigration).toContain(
      "p_question_count not between 1 and 500",
    );
    expect(hardeningMigration).toContain(
      "source_review_queue_ids is distinct from p_selected_queue_ids",
    );
    expect(hardeningMigration).toContain(
      "exact_review_replacement_kind_changed",
    );
    expect(hardeningMigration).toContain(
      "p_review_snapshot_mode = 'preserve'",
    );
  });
});
