import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readMigration(fileName: string) {
  return fs.readFileSync(
    path.resolve("supabase/migrations", fileName),
    "utf8",
  );
}

const selection = readMigration(
  "20260830090000_add_assignment_directory_selection_read_model.sql",
);
const directReviewAvailability = readMigration(
  "20260830100000_add_direct_review_availability.sql",
);
const immediateBulk = readMigration(
  "20260830101500_allow_immediate_bulk_assignments.sql",
);
const previousExam = readMigration(
  "20260830110000_add_assignment_previous_exam_read_model.sql",
);

describe("R5 assignment workspace migration contracts", () => {
  it.each([
    ["selection", selection],
    ["direct review availability", directReviewAvailability],
    ["immediate bulk", immediateBulk],
    ["previous exam", previousExam],
  ])("keeps %s atomic with an explicit search path", (_name, migration) => {
    expect(migration).toMatch(/\bbegin;[\s\S]*\bcommit;/i);
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("selects the complete active filter result with a 210+1 server boundary", () => {
    expect(selection).toContain(
      "create function public.list_admin_assignment_directory_selection_v1(",
    );
    expect(selection).toContain("stable\nsecurity invoker");
    expect(selection).toContain("private.is_active_admin()");
    expect(selection).toContain(
      "private.admin_student_directory_filtered_rows_v1(",
    );
    expect(selection).toContain("where student.student_status = 'active'");
    expect(selection).toContain(
      "order by student.sort_at desc, student.student_id asc",
    );
    expect(selection).toContain("limit 211");
    expect(selection).toContain("p_snapshot_at is null");
    expect(selection).toContain("to authenticated;");
    expect(selection).not.toContain("to anon");
  });

  it("loads one compatible non-review exam for an exact student and dataset pair", () => {
    expect(previousExam).toContain(
      "create function public.get_admin_assignment_previous_exam_v1(",
    );
    expect(previousExam).toContain("stable\nsecurity invoker");
    expect(previousExam).toContain("private.is_active_admin()");
    expect(previousExam).toContain("recipient.student_id = p_student_id");
    expect(previousExam).toContain("assignment.dataset_id = p_dataset_id");
    expect(previousExam).toContain(
      "assignment.assignment_purpose <> 'review'",
    );
    expect(previousExam).toContain("student.status = 'active'");
    expect(previousExam).toContain("limit 1");
    expect(previousExam).toContain("to authenticated, service_role");
    expect(previousExam).not.toContain("to anon");
  });

  it("adds an optional public time to the proven direct-review writer", () => {
    expect(directReviewAvailability).toContain(
      "add column schedule_sha256 text",
    );
    expect(directReviewAvailability).toContain(
      "create function public.create_current_wrong_review_assignment_v2(",
    );
    expect(directReviewAvailability).toContain("security definer");
    expect(directReviewAvailability).toContain(
      "public.create_current_wrong_review_assignment_v1(",
    );
    expect(directReviewAvailability).toContain(
      "p_available_until <= p_available_from",
    );
    expect(directReviewAvailability).toContain("pg_catalog.isfinite");
    expect(directReviewAvailability).toContain(
      "available_from_epoch_microseconds",
    );
    expect(directReviewAvailability).toContain(
      "extract(epoch from p_available_from) * 1000000",
    );
    expect(directReviewAvailability).toContain(
      "request_row.schedule_sha256 is distinct from schedule_sha256_value",
    );
    expect(directReviewAvailability).toContain(
      "if request_row.assignment_id is not null then",
    );
    expect(directReviewAvailability).toContain(
      "set available_from = p_available_from",
    );
    expect(directReviewAvailability).toContain(
      "updated_assignment_count <> 1",
    );
    expect(directReviewAvailability).toContain("to authenticated;");
    expect(directReviewAvailability).not.toContain("to anon");
  });

  it("allows only one truly unscheduled session or a fully ordered schedule", () => {
    expect(immediateBulk).toContain(
      "private.create_bulk_vocab_assignments_v7(uuid,text,jsonb)",
    );
    expect(immediateBulk).toContain(
      "private.create_bulk_vocab_assignments_v10(",
    );
    expect(immediateBulk).toContain(
      "create function public.create_bulk_vocab_assignments_v10(",
    );
    expect(immediateBulk).toContain("private.is_active_admin()");
    expect(immediateBulk).toContain(
      "nullif(input.item ->> 'available_from', '') is null",
    );
    expect(immediateBulk).toContain(
      "nullif(input.item ->> 'session_number', '')::integer <> 1",
    );
    expect(immediateBulk).toContain(
      "nullif(input.item ->> 'session_count', '')::integer <> 1",
    );
    expect(immediateBulk).toContain(
      "nullif(btrim(input.item ->> 'available_until'), '')::timestamptz <=",
    );
    expect(immediateBulk).toContain("pg_catalog.isfinite");
    expect(immediateBulk).toContain(
      "stored_payload_sha256 is distinct from payload_sha256_value",
    );
    expect(immediateBulk).toContain("total_question_count > 10000");
    expect(immediateBulk).toContain("private.configure_assignment_retry_v1(");
    expect(immediateBulk).toContain(
      "revoke all on function private.create_bulk_vocab_assignments_v10(",
    );
    expect(immediateBulk).toContain("to authenticated, service_role");
  });
});
