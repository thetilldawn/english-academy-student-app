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

  it("queues selected words without creating a retest or navigating away", () => {
    const panel = source(
      "src/components/student-wrong-word-panel.tsx",
    );

    expect(panel).toContain("async function queueSelectedWords()");
    expect(panel).toContain(
      "questionIds: validSelectedQuestionIds",
    );
    expect(panel).toContain("다음 시험에 추가");
    expect(panel).toContain("refreshHistory()");
    expect(panel).toContain(
      'target.scheduling === "available"',
    );
    expect(panel).not.toContain("createReviewAssignmentDraft(");
    expect(panel).not.toContain("router.push(");
  });

  it("cleans up legacy pending drafts without removing queued words", () => {
    const route = source(
      "src/app/api/admin/students/[id]/review-assignment-drafts/[draftId]/route.ts",
    );
    const service = source(
      "src/lib/services/review-assignment-service.ts",
    );
    const panel = source(
      "src/components/student-wrong-word-panel.tsx",
    );
    const dialog = source(
      "src/components/review-assignment-dialog.tsx",
    );
    const css = source("src/app/globals.css");

    expect(route).toContain("export async function DELETE(");
    expect(route).toContain("isSameOriginRequest(request)");
    expect(route).toContain("getAdminContext()");
    expect(route.match(/z\.uuid\(\)/g)).toHaveLength(2);
    expect(route).toContain(
      "cancelStudentReviewAssignmentDraft(id, draftId, admin)",
    );
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(route).toContain('queueDisposition: "pending"');
    expect(service).toContain(
      '"cancel_student_vocab_review_assignment_draft"',
    );
    expect(panel).toContain('method: "DELETE"');
    expect(panel).toContain("재시험 준비 취소");
    expect(panel).toContain("다음 일반 시험 대기에 남아 있습니다");
    expect(panel).toContain("이전 방식으로 준비 중인 재시험");
    expect(panel).toContain("다음 시험 대기");
    expect(dialog).toContain('method: "DELETE"');
    expect(dialog).toContain("다음 시험 대기 유지");
    expect(css).toContain(".wrong-word-list-with-actions");
    expect(css).toContain("scroll-padding-bottom");
  });

  it("loads wrong words only inside the student detail tab", () => {
    const manager = source("src/components/student-manager.tsx");
    const panel = source(
      "src/components/student-wrong-word-panel.tsx",
    );
    expect(manager).toContain('"learning" | "account" | "history"');
    expect(manager).toContain("<StudentWrongWordPanel");
    expect(manager).toContain("단어 학습 관리");
    expect(panel).toContain(
      "/api/admin/students/${studentId}/wrong-words",
    );
    expect(panel).toContain('cache: "no-store"');
    expect(panel).toContain("AbortController");
    expect(panel).toContain("WRONG_HISTORY_CACHE_TTL_MS");
    expect(panel).toContain("새로고침");
    expect(manager).toContain("moveDialogTabFocus");
    expect(panel).toContain("누적 2회 이상");
    expect(panel).toContain('type="checkbox"');
    expect(panel).toContain('target?.scheduling === "queued"');
    expect(panel).toContain('target?.scheduling === "assigned"');
    expect(panel).toContain("다음 시험 대기");
    expect(panel).toContain("배정 중");
    expect(panel).toContain("해결됨");
    expect(panel).toContain(
      "occurrence.datasetId === datasetFilter",
    );
    expect(panel).toContain(
      "questionId: selectedOccurrence.latestQuestionId",
    );
    expect(panel).toContain('method: "POST"');
    expect(panel).toContain("다음 시험에 추가");
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain("refreshAfterRequestRef");
    expect(panel).toContain("loading || queueing");
    expect(panel).not.toContain("router.refresh");
  });

  it("keeps the wrong-word list single-view and clears hidden selections when filters change", () => {
    const panel = source(
      "src/components/student-wrong-word-panel.tsx",
    );

    expect(panel).not.toContain("type ViewMode");
    expect(panel).not.toContain("wrong-word-attempt-tab");
    expect(panel).not.toContain("wrong-word-attempt-panel");
    expect(panel).not.toContain("moveViewTabFocus");
    expect(panel).toContain(
      "new Set(selectableFilteredQuestionIds)",
    );
    expect(panel).toContain(
      "allVisibleSelected ? [] : selectableFilteredQuestionIds",
    );
    expect(panel).toContain("function resetSelectionFeedback()");
    expect(panel).toContain("if (levelFilter === value)");
    expect(panel.match(/resetSelectionFeedback\(\);/g)).toHaveLength(3);
  });

  it("pages all initial-wrong history without a fixed event ceiling", () => {
    const service = source(
      "src/lib/services/wrong-word-service.ts",
    );
    const activeAssignments = source(
      "src/lib/services/active-review-assignment-service.ts",
    );
    expect(service).toContain("WRONG_EVENT_PAGE_SIZE = 500");
    expect(service).toContain('.order("id", { ascending: false })');
    expect(service).toContain('query = query.lt("id", beforeId)');
    expect(service).toContain(".limit(WRONG_EVENT_PAGE_SIZE)");
    expect(service).toContain('.eq("wrong_stage", "initial")');
    expect(service).toContain(
      '.from("student_vocab_review_queue")',
    );
    expect(service).toContain("loadActiveReviewAssignments(");
    expect(activeAssignments).toContain(
      '.from("assignment_review_targets")',
    );
    expect(activeAssignments).toContain(
      '.from("assignment_questions")',
    );
    expect(service).not.toContain('.from("quiz_attempts")');
    expect(service).not.toContain("MAX_WRONG_EVENTS");
  });

  it("exposes only the clamped prior wrong level to the quiz client", () => {
    const quizService = source("src/lib/services/quiz-service.ts");
    const quizPlayer = source("src/components/quiz-player.tsx");
    expect(quizService).toContain("prior_wrong_count");
    expect(quizService).toContain("priorWrongLevel:");
    expect(quizService).toContain("question.prior_wrong_count >= 2");
    expect(quizService).not.toContain("priorWrongCount:");
    expect(quizPlayer).toContain("getPriorWrongIndicator");
    expect(quizPlayer).toContain("quiz-prior-wrong-marks");
    expect(quizPlayer).toContain("quiz-prompt-prior-wrong");
    expect(quizPlayer).toContain("aria-describedby={");
    expect(quizPlayer).toContain('"quiz-prior-wrong"');
  });
});
