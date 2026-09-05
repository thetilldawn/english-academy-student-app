import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("mobile production regression UI contract", () => {
  const css = source("src/app/globals.css");
  const quizDomain = source(
    "src/features/quiz-player/domain/quiz-session.ts",
  );
  const quizFrame = source(
    "src/features/quiz-player/ui/quiz-frame.tsx",
  );
  const quizFrameCss = source(
    "src/features/quiz-player/ui/quiz-frame.module.css",
  );
  const quizTimeoutOverlay = source(
    "src/features/quiz-player/ui/quiz-timeout-overlay.tsx",
  );
  const quizChoiceCss = source(
    "src/features/quiz-player/ui/quiz-choice.module.css",
  );
  const studentDirectory = source(
    "src/features/students/ui/student-directory.tsx",
  );
  const studentDirectoryCard = source(
    "src/features/students/ui/student-directory-card.tsx",
  );
  const studentDirectoryCss = source(
    "src/features/students/ui/student-directory.module.css",
  );
  const studentDetail = source(
    "src/features/students/ui/student-detail-dialog.tsx",
  );
  const studentDetailContent = source(
    "src/features/students/ui/student-detail-content.tsx",
  );
  const studentAccount = source(
    "src/features/students/ui/panels/student-account-panel.tsx",
  );
  const studentController = source(
    "src/features/students/controller/use-student-access-controller.ts",
  );
  it("keeps the student card to the requested summary fields", () => {
    expect(studentDirectory).toContain("<StudentDirectoryList");
    expect(studentDirectoryCard).toContain("student.completedCount");
    expect(studentDirectoryCard).toContain("student.missedCount");
    expect(studentDirectoryCard).toContain("student.notStartedCount");
    expect(studentDirectoryCss).toContain(".activityStats");
  });

  it("shows an existing student's code inside one modal level", () => {
    const codePanel = source(
      "src/features/students/ui/panels/student-code-panel.tsx",
    );
    expect(studentDetail.match(/<RoutedDetailDialog/g)).toHaveLength(1);
    expect(studentDetailContent).toContain("<StudentAccountPanel");
    expect(studentAccount).toContain("<StudentCodePanel");
    expect(codePanel).not.toContain("<DialogFrame");
    expect(studentController).toContain("setCodeState({");
    expect(studentController).toContain("clearCode: () => setCodeState(null)");
  });

  it("reserves pronunciation columns only where the visible text is English", () => {
    expect(quizDomain).toContain(
      'question.direction === "english_to_korean"',
    );
    expect(quizDomain).toContain(
      'question.direction === "korean_to_english"',
    );
    expect(quizDomain).toContain("pronunciation.available");
    expect(quizFrame).toContain(
      "quizChoicePresentation(currentQuestion, index)",
    );
    expect(quizDomain).toContain('kind: "korean-meaning", text, audioUrl: null');
    expect(quizDomain).toContain('kind: "english-word"');
    expect(quizDomain).toContain("pronunciation?.available ? pronunciation.audioUrl : null");
    expect(quizFrame).not.toContain("placeholder");
    expect(quizFrameCss).toMatch(
      /\.promptRow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(quizFrameCss).toMatch(
      /\.promptWithAudio\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 46px;/,
    );
    expect(quizChoiceCss).toMatch(
      /\.row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(quizChoiceCss).toMatch(
      /\.withAudio\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 46px;/,
    );
    expect(quizChoiceCss).toMatch(
      /\.row\s*\{[^}]*align-items:\s*center;/,
    );
    expect(quizChoiceCss).toMatch(
      /\.text\s*\{[^}]*overflow-wrap:\s*anywhere;/,
    );
  });

  it("keeps answer feedback out of the visual layout", () => {
    expect(quizFrame).toContain("{answerAnnouncement}");
    expect(quizFrame).toContain('className="sr-only"');
    expect(quizFrame).not.toContain("feedback-correct");
    expect(css).not.toContain(".feedback {");
    expect(css).not.toContain(".feedback-wrong");
    expect(css).not.toContain(".quiz-prompt-prior-wrong");
    expect(css).not.toContain(".quiz-error");
    expect(quizFrame).toContain("<QuizTimeoutOverlay visible={timedOut} />");
    expect(quizTimeoutOverlay).toContain("quiz-timeout-overlay");
    expect(quizTimeoutOverlay).toContain(
      "studentAppText.attempt.timeoutTitle",
    );
    expect(quizChoiceCss).toMatch(
      /\.row\s*\{[^}]*min-height:\s*76px;/,
    );
    expect(quizChoiceCss).toMatch(
      /\.choice\s*\{[^}]*min-height:\s*76px;/,
    );
    expect(quizChoiceCss).toContain("background-color 90ms ease-out");
    expect(quizChoiceCss).toMatch(
      /\.selected\s*\{[^}]*border-color:\s*var\(--ink\);/,
    );
    expect(quizChoiceCss).not.toContain("-webkit-line-clamp");
    expect(quizFrameCss).not.toContain("max-height: 142px");
  });
});
