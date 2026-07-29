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
      "selectedQueueRows.length >= input.totalQuestionCount",
    );
    expect(route).toContain('error.reason === "conflict"');
    expect(route).toContain("409");
    expect(route).not.toContain("error.message");
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
    expect(service).toContain(".limit(input.reviewLimit)");
    expect(service).toContain(
      "const selectedQueueIds = selectedQueueRows.map",
    );
    expect(service).toContain("createMixedQuizQuestions(");
    expect(service).toContain(
      '"create_mixed_review_assignment_v5"',
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

  it("excludes every pending exact or canonical identity from general targets", () => {
    const service = source(
      "src/lib/services/mixed-assignment-service.ts",
    );

    expect(service).toContain(
      "loadAllPendingReviewIdentities(",
    );
    expect(service).toContain(
      "excludePendingReviewCandidates(",
    );
    expect(service).toContain(
      "loadEligibleVocabularyDataset(supabase, input.datasetId)",
    );
  });
});
