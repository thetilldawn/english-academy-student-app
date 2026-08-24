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
      "src/features/students/ui/panels/student-wrong-word-panel.tsx",
    );
    const selection = source(
      "src/features/students/domain/wrong-word-selection.ts",
    );
    const actions = source(
      "src/features/students/controller/use-student-wrong-word-actions.ts",
    );
    const controls = source(
      "src/features/students/ui/panels/wrong-word-selection-controls.tsx",
    );
    const copy = source("src/content/ko/admin-students.ts");
    const queueFunction = panel.slice(
      panel.indexOf("async function queueSelectedWords()"),
      panel.indexOf("async function createWorksheetRequest()"),
    );

    expect(panel).toContain("async function queueSelectedWords()");
    expect(queueFunction).toContain("queueWords(");
    expect(queueFunction).toContain("validSelectedQuestionIds,");
    expect(queueFunction).toContain("refreshHistory()");
    expect(queueFunction).not.toContain("worksheetSelectedQuestionIds");
    expect(controls).toContain("copy.addToNextExam");
    expect(copy).toContain('addToNextExam: "다음 시험에 추가"');
    expect(selection).toContain(
      'target.scheduling !== "available"',
    );
    expect(actions).toContain("queueStudentWrongWords(studentId, questionIds)");
    expect(actions).toContain("actionInFlightRef.current = true");
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
      "src/features/students/ui/panels/student-wrong-word-panel.tsx",
    );
    const actions = source(
      "src/features/students/controller/use-student-wrong-word-actions.ts",
    );
    const list = source(
      "src/features/students/ui/panels/wrong-word-list.tsx",
    );
    const transport = source(
      "src/features/students/api/wrong-word-transport.ts",
    );
    const recovery = source(
      "src/features/assignments/ui/legacy-review-recovery.tsx",
    );
    const recoveryController = source(
      "src/features/assignments/controller/use-legacy-review-recovery.ts",
    );
    const copy = source("src/content/ko/admin-learning.ts");
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
    expect(transport).toContain('{ method: "DELETE" }');
    expect(actions).toContain("cancelStudentReviewDraft(studentId, draftId)");
    expect(panel).toContain(
      "adminStudentsText.learning.wrongWordsPanel.cancelDraft",
    );
    expect(panel).toContain(
      "adminStudentsText.learning.wrongWordsPanel.cancelDraftSuccess",
    );
    expect(panel).toContain(
      "adminStudentsText.learning.wrongWordsPanel.legacyDraftNotice",
    );
    expect(list).toContain("copy.pending");
    expect(recoveryController).toContain("method: request.method");
    expect(recovery).toContain(
      "adminLearningText.reviewAssignmentModal.cancelDraft",
    );
    expect(copy).toContain("다음 시험 대기로 되돌린");
    const panelCss = source(
      "src/features/students/ui/panels/student-wrong-word-panel.module.css",
    );
    expect(css).not.toContain(".wrong-word-");
    expect(panelCss).toContain("scroll-padding-bottom");
  });

  it("loads wrong words only inside the student history tab", () => {
    const detail = source(
      "src/features/students/ui/student-detail-dialog.tsx",
    );
    const history = source(
      "src/features/students/ui/panels/student-history-panel.tsx",
    );
    const panel = source(
      "src/features/students/ui/panels/student-wrong-word-panel.tsx",
    );
    const transport = source(
      "src/features/students/api/wrong-word-transport.ts",
    );
    const loader = source(
      "src/features/students/controller/use-student-wrong-word-history.ts",
    );
    const selection = source(
      "src/features/students/domain/wrong-word-selection.ts",
    );
    const filter = source(
      "src/features/students/ui/panels/wrong-word-filter-section.tsx",
    );
    const list = source(
      "src/features/students/ui/panels/wrong-word-list.tsx",
    );
    const controls = source(
      "src/features/students/ui/panels/wrong-word-selection-controls.tsx",
    );
    expect(detail).toContain("<Tabs");
    expect(detail).toContain("ariaLabel={adminStudentsText.detail.tabsAria}");
    expect(history).toContain("<StudentWrongWordPanel");
    expect(history).toContain(
      'initialDatasetId={student.currentVocabDatasetId ?? ""}',
    );
    expect(history).toContain("key={student.id}");
    expect(detail).not.toMatch(/StudentAssignmentPanel|StudentLearningPanel/);
    expect(transport).toContain(
      "/api/admin/students/${studentId}/wrong-words",
    );
    expect(transport).toContain('cache: "no-store"');
    expect(loader).toContain("AbortController");
    expect(loader).toContain("WRONG_HISTORY_CACHE_TTL_MS");
    expect(loader).toContain("requestSequenceRef");
    expect(panel).toContain(
      "adminStudentsText.learning.wrongWordsPanel.refresh",
    );
    expect(panel).toContain("useState(initialDatasetId)");
    expect(filter).toContain('["repeated", copy.repeated]');
    expect(list).toContain("<Checkbox");
    expect(list).toContain(
      'nextExamTarget?.scheduling === "queued"',
    );
    expect(list).toContain(
      'nextExamTarget?.scheduling === "assigned"',
    );
    expect(list).toContain("copy.pending");
    expect(list).toContain("copy.assigned");
    expect(list).toContain("copy.resolved");
    expect(selection).toContain(
      "candidate.datasetId === datasetId",
    );
    expect(selection).toContain(
      "questionId: occurrence.latestQuestionId",
    );
    expect(transport).toContain('method: "POST"');
    expect(controls).toContain("copy.addToNextExam");
    expect(controls).toContain('aria-live="polite"');
    expect(loader).toContain("refreshAfterRequestRef");
    expect(panel).toContain("disabled={loading || busy}");
    expect(panel).not.toContain("router.refresh");
  });

  it("keeps worksheet selection independent and exports a private anonymous packet", () => {
    const panel = source(
      "src/features/students/ui/panels/student-wrong-word-panel.tsx",
    );
    const copy = source("src/content/ko/admin-students.ts");
    const selection = source(
      "src/features/students/domain/wrong-word-selection.ts",
    );
    const actions = source(
      "src/features/students/controller/use-student-wrong-word-actions.ts",
    );
    const list = source(
      "src/features/students/ui/panels/wrong-word-list.tsx",
    );
    const purpose = source(
      "src/features/students/ui/panels/wrong-word-purpose-section.tsx",
    );
    const requestRoute = source(
      "src/app/api/admin/students/[id]/worksheet-requests/route.ts",
    );
    const exportRoute = source(
      "src/app/api/admin/worksheet-requests/[id]/export/route.ts",
    );
    const worksheetFunction = panel.slice(
      panel.indexOf("async function createWorksheetRequest()"),
      panel.indexOf("async function cancelReviewAssignmentDraft("),
    );

    expect(selection).toContain(
      'export type WrongWordSelectionPurpose = "next_exam" | "worksheet"',
    );
    expect(panel).toContain("worksheetSelectedQuestionIds");
    expect(panel).toContain("validWorksheetSelectedQuestionIds");
    expect(list).toContain("selectWorksheetWrongWordTarget(");
    expect(purpose).toContain("aria-label={copy.purposeAria}");
    expect(copy).toContain("한 번에 50개까지");
    expect(purpose).toContain(
      "adminStudentsText.learning.worksheetWrongWordHelp",
    );
    expect(worksheetFunction).toContain(
      "questionIds: validWorksheetSelectedQuestionIds",
    );
    expect(worksheetFunction).toContain("requestWorksheet({");
    expect(actions).toContain("createStudentWorksheetRequest(studentId, input)");
    expect(worksheetFunction).not.toContain("refreshHistory()");
    expect(worksheetFunction).not.toContain("setSelectedQuestionIds(");
    expect(requestRoute).toContain('export const dynamic = "force-dynamic"');
    expect(requestRoute).toContain("isSameOriginRequest(request)");
    expect(requestRoute).toContain("getAdminContext()");
    expect(requestRoute).toContain(
      "parseJson(request, createWrongWordWorksheetRequestSchema)",
    );
    expect(requestRoute).toContain('"Cache-Control": "private, no-store"');
    expect(exportRoute).toContain('"Content-Disposition"');
    expect(exportRoute).toContain('"X-Content-Type-Options": "nosniff"');
    expect(exportRoute).toContain('"Cache-Control": "private, no-store"');
  });

  it("keeps the wrong-word list single-view and clears hidden selections when filters change", () => {
    const panel = source(
      "src/features/students/ui/panels/student-wrong-word-panel.tsx",
    );
    const selection = source(
      "src/features/students/domain/wrong-word-selection.ts",
    );

    expect(panel).not.toContain("type ViewMode");
    expect(panel).not.toContain("wrong-word-attempt-tab");
    expect(panel).not.toContain("wrong-word-attempt-panel");
    expect(panel).not.toContain("moveViewTabFocus");
    expect(selection).toContain(
      "new Set(selectableQuestionIds)",
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
    expect(service).toContain(
      "const authenticatedSupabase = await createServerSupabaseClient()",
    );
    expect(service).toContain(
      "loadActiveReviewAssignments(\n      authenticatedSupabase,",
    );
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
    const quizService = source(
      "src/lib/services/quiz/attempt-query.ts",
    );
    const quizController = source(
      "src/features/quiz-player/controller/use-quiz-player-controller.ts",
    );
    const quizFrame = source(
      "src/features/quiz-player/ui/quiz-frame.tsx",
    );
    expect(quizService).toContain("prior_wrong_count");
    expect(quizService).toContain("priorWrongLevel:");
    expect(quizService).toContain("question.prior_wrong_count >= 2");
    expect(quizService).not.toContain("priorWrongCount:");
    expect(quizController).toContain("getPriorWrongIndicator");
    expect(quizFrame).toContain("styles.priorWrongMarks");
    expect(quizFrame).not.toContain("quiz-prompt-prior-wrong");
    expect(quizFrame).toContain("aria-describedby={");
    expect(quizFrame).toContain('"quiz-prior-wrong"');
  });
});
