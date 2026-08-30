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
    const validation = source(
      "src/lib/admin/mixed-assignment-request.ts",
    );

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
    expect(service).toContain("buildAssignmentQuestionPlan({");
    expect(service).toContain(
      '"create_mixed_review_assignment_v10"',
    );
    expect(service).toContain("p_retry_enabled: prepared.retryEnabled");
    expect(service).toContain(
      "p_retry_passing_score: prepared.retryPassingScore",
    );
    expect(service).toContain(
      "p_selected_queue_ids: prepared.selectedQueueIds",
    );
    expect(service).toContain(
      "p_review_scope: prepared.reviewScope",
    );
    expect(service).toContain(
      "p_questions: prepared.questions",
    );
    expect(service).not.toContain(
      "p_selected_queue_ids: input.",
    );
    expect(service).not.toContain("p_questions: input.");
  });

  it("keeps active assignment locks for wrong queues and excludes only active review targets from general rows", () => {
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
    expect(activeAssignments).toContain("activeReviewIdentities(");
    expect(activeAssignments).toContain("reviewIdentities");
    expect(service).toContain(
      "activeReviewAssignments.reviewIdentities.has(identity)",
    );
    expect(service).toContain(
      "selectedReviewIdentities",
    );
    expect(service).toContain(
      "loadEligibleVocabularyDataset(supabase, datasetId, {",
    );
    expect(service).toContain(
      "loadDatasetForPreparation(supabase, input.datasetId)",
    );
    expect(service).toContain(
      "includeExamUseProjection: true",
    );
    expect(service).toContain('const reviewScope = input.reviewScope ?? "dataset"');
    expect(service).toContain("resolveReviewCandidate(");
    expect(service).toContain("primaryUnitIdSet,");
    expect(service).toContain(
      "eligibleReviewRows.map((row) => row.reason_level)",
    );
  });

  it("keeps current-wrong exams and manual review queues in separate services", () => {
    const mixedService = source(
      "src/lib/services/mixed-assignment-service.ts",
    );
    const directPreparation = source(
      "src/lib/services/direct-review-preparation-service.ts",
    );
    const directService = source(
      "src/lib/services/direct-review-assignment-service.ts",
    );

    expect(mixedService).not.toContain("current_wrong");
    expect(mixedService).not.toContain("DirectReview");
    expect(mixedService).not.toContain("buildExactAssignmentQuestionPlan");
    expect(mixedService).not.toContain("source_question_id");

    for (const directSource of [directPreparation, directService]) {
      expect(directSource).not.toContain("mixed-assignment-service");
      expect(directSource).not.toContain("student_vocab_review_queue");
      expect(directSource).not.toContain("create_mixed_review_assignment");
    }
    expect(directService).toContain(
      '"create_current_wrong_review_assignment_v2"',
    );
    expect(directService).toContain(
      "p_available_from: prepared.availableFrom",
    );
  });
});
