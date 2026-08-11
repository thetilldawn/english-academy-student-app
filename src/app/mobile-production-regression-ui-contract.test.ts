import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("mobile production regression UI contract", () => {
  const css = source("src/app/globals.css");
  const quizPlayer = source("src/components/quiz-player.tsx");
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
  const studentPage = source("src/app/student/(protected)/page.tsx");

  it("puts missed deadlines in their own final section", () => {
    const completedIndex = studentPage.indexOf('id: "completed"');
    const deadlineClosedIndex = studentPage.indexOf('id: "deadline-closed"');

    expect(studentPage).toContain("!assignment.missed &&");
    expect(studentPage).toContain(
      "assignments.filter((assignment) => assignment.missed)",
    );
    expect(completedIndex).toBeGreaterThan(-1);
    expect(deadlineClosedIndex).toBeGreaterThan(completedIndex);
  });

  it("uses the shared tag component with one stable assignment tag height", () => {
    const badgeCss = source(
      "src/design-system/primitives/badge/badge.module.css",
    );
    expect(studentPage).toContain(
      '<MetaTagList className="assignment-details" fullWidth>',
    );
    expect(studentPage).toContain('overflow="truncate" size="large"');
    expect(studentPage).not.toContain('className="detail-chip"');
    expect(css).not.toMatch(/\.assignment-details \.meta-tag/);
    expect(badgeCss).toMatch(
      /\.large\s*\{[^}]*min-height:\s*28px;/,
    );
  });

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
    expect(quizPlayer).toContain(
      'currentQuestion?.direction === "english_to_korean"',
    );
    expect(quizPlayer).toContain(
      'currentQuestion?.direction === "korean_to_english"',
    );
    expect(quizPlayer).toContain("choicesUsePronunciation &&");
    expect(quizPlayer).toContain("choice-copy--without-pronunciation");
    expect(quizPlayer).toContain(
      'import type { QuizDirection } from "@/lib/quiz/engine";',
    );

    expect(css).toMatch(
      /\.quiz-prompt-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /\.quiz-prompt-row--with-pronunciation\s*\{[^}]*grid-template-columns:\s*46px minmax\(0, 1fr\) 46px;/,
    );
    expect(css).toMatch(
      /\.choice-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /\.choice-row--with-pronunciation\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 46px;/,
    );
  });

  it("keeps answer feedback out of the visual layout", () => {
    expect(quizPlayer).not.toContain("quiz-prompt-prior-wrong");
    expect(quizPlayer).toContain("const answerAnnouncement =");
    expect(quizPlayer).toContain("{answerAnnouncement}");
    expect(quizPlayer).not.toContain('className="feedback feedback-wrong"');
    expect(quizPlayer).not.toContain("feedback-correct");
    expect(css).not.toContain(".feedback {");
    expect(css).not.toContain(".feedback-wrong");
    expect(css).not.toContain(".quiz-prompt-prior-wrong");
  });
});
