import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function compact(value: string) {
  return value.replace(/\s+/g, " ");
}

describe("regular assignment scope contract", () => {
  it("builds regular questions and capacity from the selected units only", () => {
    const adminService = compact(
      source("src/lib/services/admin-service.ts"),
    );
    const mixedService = compact(
      source("src/lib/services/mixed-assignment-service.ts"),
    );

    expect(adminService).toContain(
      "buildAssignmentQuestionPlan({ primaryCandidates, allCandidates: primaryCandidates,",
    );
    expect(mixedService).toContain(
      "calculateAssignmentQuestionRange({ primaryCandidates, allCandidates: primaryCandidates,",
    );
  });

  it("orders the base question bank by the teacher's selected unit direction", () => {
    const adminService = compact(
      source("src/lib/services/admin-service.ts"),
    );

    expect(adminService).toContain(
      "const unitPositionById = new Map( orderedUnitIds.map",
    );
    expect(adminService).toContain(
      "unitPositionById.get( unitIdByCandidateId.get(left.vocabEntryId)",
    );
  });

  it("restores only previously selected unresolved review words", () => {
    const migration = source(
      "supabase/migrations/20260731020000_reopen_selected_unresolved_review_queue.sql",
    );

    expect(migration).toContain(
      "private.reopen_selected_vocab_review_queue_v1",
    );
    expect(migration).toContain(
      "queue.status in ('consumed', 'cancelled')",
    );
    expect(migration).toContain(
      "assignment_review_targets_reopen_queue_after_missed",
    );
    expect(migration).not.toContain(
      "insert into public.student_vocab_review_queue",
    );
  });
});
