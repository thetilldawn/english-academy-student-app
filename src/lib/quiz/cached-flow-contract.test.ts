import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("DAY 문제은행 응시 계약", () => {
  it("새 배정은 DAY와 고정 문제은행을 사용한다", () => {
    const rangeFields = source(
      "src/features/assignments/ui/assignment-range-fields.tsx",
    );
    const settingsFields = source(
      "src/features/assignments/ui/assignment-settings-fields.tsx",
    );
    const bulkExamFields = source(
      "src/features/assignments/ui/bulk-exam-fields.tsx",
    );
    const adminService = source("src/lib/services/admin-service.ts");
    const eligibleLoader = source(
      "src/lib/services/eligible-vocabulary-service.ts",
    );
    const copy = source("src/content/ko/admin-learning.ts");

    expect(rangeFields).toContain("<AssignmentUnitRangePicker");
    expect(rangeFields).not.toContain("selectInclusiveUnitRange");
    expect(settingsFields).toContain("<ExamQuestionOrderField");
    expect(bulkExamFields).toContain('trigger="시험 문제 순서"');
    expect(bulkExamFields).toContain("순서대로");
    expect(bulkExamFields).toContain("무작위");
    expect(bulkExamFields).toContain('value === "random"');
    expect(copy).toContain('questionCount: "단어 수"');
    expect(adminService).toContain(
      '"create_assignment_with_delivery_v7"',
    );
    expect(adminService).toContain(
      "loadEligibleVocabularyDataset(",
    );
    expect(adminService).toContain("buildAssignmentQuestionPlan({");
    expect(adminService).toContain("p_available_until");
    expect(adminService).toContain("base_order_index");
    expect(adminService).toContain("choice_vocab_entry_ids");
    expect(adminService).not.toContain(
      "correct_choice_index: question.correctChoiceIndex",
    );
    expect(eligibleLoader).toContain(
      '.from("vocab_entry_quiz_eligibility")',
    );
    expect(eligibleLoader).toContain(
      '.in("status", ["eligible", "review_required"])',
    );
  });

  it("새 시도는 문제를 다시 만들지 않고 문제은행에서 복사한다", () => {
    const quizService = source("src/lib/services/quiz-service.ts");

    expect(quizService).toContain(
      '"create_quiz_attempt_from_bank"',
    );
    expect(quizService).toContain(
      'assignment.range_basis === "units"',
    );
    expect(quizService).toContain(
      "assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey",
    );
  });

  it("정상 답안 뒤에는 재조회하지 않고 오류 때만 한 번 복구한다", () => {
    const controller = source(
      "src/features/quiz-player/controller/use-quiz-player-controller.ts",
    );
    const submission = source(
      "src/features/quiz-player/controller/use-quiz-submission.ts",
    );
    const transport = source(
      "src/features/quiz-player/api/quiz-attempt.ts",
    );
    const domain = source(
      "src/features/quiz-player/domain/quiz-session.ts",
    );

    expect(domain).toContain("payload.nextQuestionId");
    expect(controller).not.toContain("refreshAttempt");
    expect(controller).not.toContain("}, 800)");
    expect(controller).toContain("const recoverFromServer");
    expect(submission).toContain("if (await tryRecover()) return");
    expect(domain).toContain("ANSWER_FEEDBACK_DELAY_MS = 750");
    expect(controller).not.toContain("router.refresh()");
    expect(
      transport.match(
        /boundedFetch\(`\/api\/student\/attempts\/\$\{attemptId\}`/g,
      ),
    ).toHaveLength(1);
  });
});
