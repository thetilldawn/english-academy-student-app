import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(filePath: string) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

describe("mixed assignment API contract", () => {
  it("keeps the browser boundary single-student, strict and private", () => {
    const route = source(
      "src/app/api/admin/mixed-assignments/route.ts",
    );
    const validation = source("src/lib/validation.ts");

    expect(route).toContain('dynamic = "force-dynamic"');
    expect(route).toContain("isSameOriginRequest(request)");
    expect(route).toContain("getAdminContext()");
    expect(route).toContain(
      "parseJson(request, mixedAssignmentSchema)",
    );
    expect(route).toContain("createMixedAssignment(input, admin)");
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(validation).toContain(
      "export const mixedAssignmentSchema",
    );
    expect(validation).toContain("studentId: z.uuid()");
    expect(validation).toContain(".strict()");
    expect(validation).not.toContain(
      "mixedAssignmentSchema = assignmentSchema",
    );
  });

  it("maps queue races to 409 without exposing database details", () => {
    const route = source(
      "src/app/api/admin/mixed-assignments/route.ts",
    );
    const service = source(
      "src/lib/services/mixed-assignment-service.ts",
    );

    expect(service).toContain(
      "mixedAssignmentDatabaseErrorReason(error)",
    );
    expect(service).toContain(
      "input.totalQuestionCount < capacity.minimumQuestionCount",
    );
    expect(route).toContain('error.reason === "conflict"');
    expect(route).toContain("409");
    expect(route).toContain("jsonError(error.message, 409)");
    expect(route).toContain(
      '"DAY+오답 시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요."',
    );
    expect(route).not.toContain("selectedQueueIds");
  });

  it("selects queue IDs and questions only on the server", () => {
    const service = source(
      "src/lib/services/mixed-assignment-service.ts",
    );

    expect(service).toContain('.eq("status", "pending")');
    expect(service).toContain(
      '.is("reserved_review_draft_id", null)',
    );
    expect(service).toContain(
      '.order("reason_level", { ascending: false })',
    );
    expect(service).toContain('.order("queued_at")');
    expect(service).toContain('.order("id")');
    expect(service).toContain(
      ".range(offset, offset + REVIEW_QUEUE_PAGE_SIZE - 1)",
    );
    expect(service).toContain(
      "const selectedQueueIds = prepared.selectedQueueRows.map",
    );
    expect(service).toContain("createMixedQuizQuestions(");
    expect(service).toContain(
      '"create_mixed_review_assignment_v6"',
    );
    expect(service).toContain(
      "p_selected_queue_ids: selectedQueueIds",
    );
    expect(service).toContain(
      "p_questions: questionDrafts.map",
    );
    expect(service).not.toContain(
      "p_selected_queue_ids: input.",
    );
    expect(service).not.toContain("p_questions: input.");
  });

  it("excludes selected wrong identities and active assignments from general targets", () => {
    const service = source(
      "src/lib/services/mixed-assignment-service.ts",
    );
    const activeAssignments = source(
      "src/lib/services/active-review-assignment-service.ts",
    );

    expect(service).toContain(
      "excludePendingReviewCandidates(",
    );
    expect(service).toContain(
      "loadActiveReviewAssignments(",
    );
    expect(activeAssignments).toContain(
      '.from("assignment_review_targets")',
    );
    expect(activeAssignments).toContain(
      '.from("assignment_students")',
    );
    expect(activeAssignments).toContain(
      '.from("assignment_questions")',
    );
    expect(service).toContain(
      "selectedReviewIdentities",
    );
    expect(service).toContain(
      "loadEligibleVocabularyDataset(supabase, input.datasetId)",
    );
  });
});
