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
  const studentDirectoryCss = source(
    "src/features/students/ui/student-directory.module.css",
  );
  const studentDetail = source(
    "src/features/students/ui/student-detail-dialog.tsx",
  );
  const studentController = source(
    "src/features/students/controller/use-student-detail-controller.ts",
  );
  it("stacks score and timeline before the student card can overflow", () => {
    expect(studentDirectory).toContain("hasAttemptScoreContent(");
    expect(studentDirectory).toContain('data-has-score={hasScore || undefined}');
    expect(studentDirectoryCss).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.scoreLine\[data-has-score="true"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    const timelineCss = source(
      "src/design-system/patterns/activity-timeline/activity-timeline.module.css",
    );
    expect(studentDirectory).toContain('align="end"');
    expect(timelineCss).toMatch(
      /\.timeline\[data-align="end"\]\s*\{[^}]*justify-items:\s*end;/,
    );
  });

  it("shows an existing student's code inside one modal level", () => {
    const codePanel = source(
      "src/features/students/ui/panels/student-code-panel.tsx",
    );
    expect(studentDetail.match(/<DialogFrame/g)).toHaveLength(1);
    expect(studentDetail).toContain(
      "onRequestClose={controller.actions.requestClose}",
    );
    expect(studentDetail).toContain('route.kind === "code"');
    expect(studentDetail).toContain("<StudentCodePanel controller={controller} />");
    expect(codePanel).not.toContain("<DialogFrame");
    expect(studentController).toContain("returnTo: state.route");
    expect(studentController).toContain("studentDetailBackRoute(state.route)");
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
      "currentQuestion.choicePronunciations[index]?.available",
    );
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
      /\.row\s*\{[^}]*height:\s*76px;/,
    );
    expect(quizChoiceCss).toMatch(
      /\.choice\s*\{[^}]*height:\s*76px;/,
    );
    expect(quizChoiceCss).toContain("background-color 90ms ease-out");
    expect(quizChoiceCss).toMatch(
      /\.selected\s*\{[^}]*border-color:\s*var\(--ink\);/,
    );
    expect(quizChoiceCss).toMatch(
      /@media \(max-width: 400px\)[\s\S]*?\.korean \.text\s*\{[^}]*-webkit-line-clamp:\s*3;/,
    );
  });
});
