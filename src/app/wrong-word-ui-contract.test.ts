import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(filePath: string) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

describe("wrong-word admin UI contract", () => {
  it("keeps personal history behind an authenticated dynamic endpoint", () => {
    const route = source(
      "src/app/api/admin/students/[id]/wrong-words/route.ts",
    );
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain("getAdminContext()");
    expect(route).toContain("z.uuid()");
    expect(route).toContain("getStudentWrongWordHistory(id, admin)");
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("queues only selected question ids through the authenticated admin session", () => {
    const route = source(
      "src/app/api/admin/students/[id]/wrong-words/route.ts",
    );
    const service = source(
      "src/lib/services/wrong-word-service.ts",
    );
    const validation = source("src/lib/validation.ts");
    expect(route).toContain("isSameOriginRequest(request)");
    expect(route).toContain("parseJson(request, queueWrongWordsSchema)");
    expect(route).toContain(
      "queueStudentWrongWords(\n      id,\n      input.questionIds,\n      admin,",
    );
    expect(service).toContain("createServerSupabaseClient()");
    expect(service).toContain(
      '"queue_student_vocab_review_words"',
    );
    expect(service).toContain("p_question_ids: questionIds");
    expect(validation).toContain(
      "export const queueWrongWordsSchema",
    );
    expect(validation).toContain(
      "new Set(value.questionIds).size === value.questionIds.length",
    );
    expect(validation).toContain(".strict()");
  });

  it("creates a durable same-dataset review draft before navigation", () => {
    const route = source(
      "src/app/api/admin/students/[id]/review-assignment-drafts/route.ts",
    );
    const service = source(
      "src/lib/services/wrong-word-service.ts",
    );
    const validation = source("src/lib/validation.ts");
    const panel = source(
      "src/components/student-wrong-word-panel.tsx",
    );

    expect(route).toContain("isSameOriginRequest(request)");
    expect(route).toContain("getAdminContext()");
    expect(route).toContain(
      "parseJson(request, createReviewAssignmentDraftSchema)",
    );
    expect(route).toContain(
      "createStudentReviewAssignmentDraft(",
    );
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(service).toContain(
      '"create_student_vocab_review_assignment_draft"',
    );
    expect(service).toContain(
      '"finalize_expired_review_assignment_drafts"',
    );
    expect(service).toContain("reserved_review_draft_id");
    expect(service).toContain("p_student_id: studentId");
    expect(service).toContain("p_question_ids: questionIds");
    expect(validation).toContain(
      "export const createReviewAssignmentDraftSchema",
    );
    expect(panel).toContain("selectedDatasetIds.size === 1");
    expect(panel).toContain(
      "선택 ${validSelectedQuestionIds.length}개 재시험 배정",
    );
    expect(panel).toContain("/review-assignment-drafts");
    expect(panel).toContain("재시험 배정 계속");
    expect(panel).toContain(
      "createReviewAssignmentDraft(group.questionIds)",
    );
    expect(panel).toContain(
      "/admin/assignments?reviewDraft=${encodeURIComponent(payload.reviewDraftId)}",
    );
    expect(panel).not.toContain(
      "/admin/assignments?questionIds=",
    );
    expect(panel).not.toContain("/admin/assignments?student=");
  });

  it("loads wrong words only inside the student detail tab", () => {
    const manager = source("src/components/student-manager.tsx");
    const panel = source(
      "src/components/student-wrong-word-panel.tsx",
    );
    expect(manager).toContain('"history" | "wrong" | "manage"');
    expect(manager).toContain("<StudentWrongWordPanel");
    expect(panel).toContain(
      "/api/admin/students/${studentId}/wrong-words",
    );
    expect(panel).toContain('cache: "no-store"');
    expect(panel).toContain("AbortController");
    expect(panel).toContain('role="tablist"');
    expect(panel).toContain("WRONG_HISTORY_CACHE_TTL_MS");
    expect(panel).toContain("새로고침");
    expect(panel).toContain("tabIndex=");
    expect(manager).toContain("moveDialogTabFocus");
    expect(panel).toContain("누적 2회 이상");
    expect(panel).toContain('type="checkbox"');
    expect(panel).toContain("pendingReviewKeys");
    expect(panel).toContain("wrongWordReviewIdentity(");
    expect(panel).toContain(
      "occurrence.datasetId === datasetFilter",
    );
    expect(panel).toContain("occurrence.latestQuestionId");
    expect(panel).toContain('method: "POST"');
    expect(panel).toContain("다음 시험에 추가");
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain("refreshAfterRequestRef");
    expect(panel).toContain("loading || queueing");
    expect(panel).not.toContain("router.refresh");
  });

  it("pages event history below the PostgREST row limit", () => {
    const service = source(
      "src/lib/services/wrong-word-service.ts",
    );
    expect(service).toContain("MAX_WRONG_EVENTS = 400");
    expect(service).toContain("WRONG_EVENT_PAGE_SIZE = 200");
    expect(service).toContain('.order("id", { ascending: false })');
    expect(service).toContain('query = query.lt("id", beforeId)');
    expect(service).toContain(".limit(pageLimit)");
    expect(service).toContain(
      '.from("student_vocab_review_queue")',
    );
    expect(service).toContain(".limit(MAX_WRONG_EVENTS + 1)");
  });

  it("exposes only the clamped prior wrong level to the quiz client", () => {
    const quizService = source("src/lib/services/quiz-service.ts");
    expect(quizService).toContain("prior_wrong_count");
    expect(quizService).toContain("priorWrongLevel:");
    expect(quizService).toContain("question.prior_wrong_count >= 2");
    expect(quizService).not.toContain("priorWrongCount:");
  });
});
