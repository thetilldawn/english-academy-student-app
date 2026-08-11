import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("mobile production regression UI contract", () => {
  const css = source("src/app/globals.css");
  const quizPlayer = source("src/components/quiz-player.tsx");
  const studentManager = source("src/components/student-manager.tsx");
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
    expect(css).toMatch(
      /@media \(max-width: 960px\)[\s\S]*?\.student-card-score-line\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    const timelineCss = source(
      "src/design-system/patterns/activity-timeline/activity-timeline.module.css",
    );
    expect(studentManager).toContain('align="end"');
    expect(timelineCss).toMatch(
      /\.timeline\[data-align="end"\]\s*\{[^}]*justify-items:\s*end;/,
    );
  });

  it("shows an existing student's code inside one modal level", () => {
    expect(studentManager).toContain('<DialogFrame');
    expect(studentManager).toContain(
      'onRequestClose={requestStudentDialogClose}',
    );
    expect(studentManager).toContain("shownCode && !selectedStudent");
    expect(studentManager).toContain("finishClosingCodeDialog");
    expect(studentManager).toMatch(
      /shownCode\s*\?\s*finishClosingCodeDialog/,
    );
    expect(studentManager).toContain(
      '<DialogBody className="student-code-dialog-body student-code-inline-body">',
    );
    expect(css).toMatch(
      /\.student-code-dialog-body \.student-code-value\s*\{[^}]*margin:\s*0;/,
    );
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
