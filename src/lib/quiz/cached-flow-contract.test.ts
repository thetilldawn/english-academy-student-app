import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("DAY 문제은행 응시 계약", () => {
  it("새 배정은 DAY와 고정 문제은행을 사용한다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const adminService = source("src/lib/services/admin-service.ts");

    expect(manager).toContain("시작 {unitTerm}");
    expect(manager).toContain("끝 {unitTerm}");
    expect(manager).toContain("무작위");
    expect(manager).toContain("오름차순");
    expect(manager).toContain("내림차순");
    expect(adminService).toContain(
      '"create_assignment_with_question_bank_v3"',
    );
    expect(adminService).toContain("p_available_until");
    expect(adminService).toContain("base_order_index");
    expect(adminService).toContain("choice_vocab_entry_ids");
    expect(adminService).not.toContain(
      "correct_choice_index: question.correctChoiceIndex",
    );
    expect(adminService).toContain(
      '.from("vocab_entry_quiz_eligibility")',
    );
    expect(adminService).toContain('.eq("status", "eligible")');
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
    const player = source("src/components/quiz-player.tsx");

    expect(player).toContain("payload.nextQuestionId");
    expect(player).toContain("payload.nextPhase");
    expect(player).not.toContain("refreshAttempt");
    expect(player).not.toContain("}, 800)");
    expect(player).toContain("const recoverAttempt");
    expect(player).toContain("if (await tryRecover()) return");
    expect(player).toContain("CORRECT_FEEDBACK_DELAY_MS = 100");
    expect(player).toContain("WRONG_FEEDBACK_DELAY_MS = 220");
    expect(player).not.toContain("router.refresh()");
    expect(
      player.match(
        /fetch\(\s*`\/api\/student\/attempts\/\$\{attempt\.id\}`/g,
      ),
    ).toHaveLength(1);
  });
});
