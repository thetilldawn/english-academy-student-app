import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(filePath: string) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

describe("exact review assignment app contract", () => {
  it("accepts only a durable draft UUID at the assignment page boundary", () => {
    const page = source(
      "src/app/admin/(protected)/assignments/page.tsx",
    );
    expect(page).toContain('reviewDraft?: string | string[]');
    expect(page).toContain("z\n    .uuid()");
    expect(page).toContain(
      "getReviewAssignmentDraftSummary(requestedReviewDraftId)",
    );
    expect(page).toContain("<ReviewAssignmentDialog");
    expect(page).toContain(
      'initialStudentId={requestedReviewDraftId ? "" : initialStudentId}',
    );
    expect(page).not.toContain("questionIds?:");
    expect(page).not.toContain("queueIds?:");
  });

  it("loads an exact private draft and chunks every UUID filter", () => {
    const service = source(
      "src/lib/services/review-assignment-service.ts",
    );
    expect(service).toContain("ID_FILTER_CHUNK_SIZE = 80");
    expect(service).toContain(
      "offset += ID_FILTER_CHUNK_SIZE",
    );
    expect(service).toContain(".in(\"id\", queueIdChunk)");
    expect(service).toContain(
      '.eq("reserved_review_draft_id", reviewDraftId)',
    );
    expect(service).toContain(
      "finalizeExpiredReviewAssignmentDrafts(draft.student_id)",
    );
    expect(service).toContain("items.length > 400");
    expect(service).toContain(
      "item.position !== index + 1",
    );
    expect(service).toContain(
      "MAX_ASSIGNMENT_TITLE_LENGTH - REVIEW_TITLE_SUFFIX.length",
    );
  });

  it("builds questions from the whole current eligible dataset", () => {
    const service = source(
      "src/lib/services/review-assignment-service.ts",
    );
    const loader = source(
      "src/lib/services/eligible-vocabulary-service.ts",
    );
    expect(loader).toContain(
      "ELIGIBLE_VOCABULARY_PAGE_SIZE = 1000",
    );
    expect(loader).toContain('.from("vocab_entries")');
    expect(loader).toContain(
      '.from("vocab_entry_quiz_eligibility")',
    );
    expect(loader).toContain('.eq("status", "eligible")');
    expect(service).toContain("loadEligibleVocabularyDataset(");
    expect(service).toContain("createTargetedQuizQuestions(");
    expect(service).toContain(
      '"create_exact_review_assignment_v4"',
    );
    expect(service).toContain(
      "base_order_index: index + 1",
    );
  });

  it("retires the standalone review POST without weakening its request guards", () => {
    const route = source(
      "src/app/api/admin/review-assignments/route.ts",
    );
    expect(route).toContain("isSameOriginRequest(request)");
    expect(route).toContain("getAdminContext()");
    expect(route).toContain("410");
    expect(route).toContain("별도 오답 재시험 배정은 종료");
    expect(route).not.toContain("createExactReviewAssignment");
  });

  it("locks student, dataset and question count while exposing only test conditions", () => {
    const dialog = source(
      "src/components/review-assignment-dialog.tsx",
    );
    expect(dialog).toContain("고정된 재시험 대상");
    expect(dialog).toContain("draft.studentName");
    expect(dialog).toContain("draft.datasetLabel");
    expect(dialog).toContain("draft.questionCount");
    expect(dialog).toContain("englishToKoreanRatio");
    expect(dialog).toContain("questionOrderMode");
    expect(dialog).toContain("timeLimitSeconds");
    expect(dialog).toContain("passingScore");
    expect(dialog).toContain("availableUntil");
    expect(dialog).not.toContain("unitIds");
    expect(dialog).not.toContain("questionIds");
    expect(dialog).toContain('router.replace("/admin/assignments")');
  });
});
