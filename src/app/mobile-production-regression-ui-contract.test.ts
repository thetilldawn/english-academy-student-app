import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("mobile production regression UI contract", () => {
  const css = source("src/app/globals.css");
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
    expect(studentPage).toContain(
      '<MetaTagList className="assignment-details">',
    );
    expect(studentPage).not.toContain('className="detail-chip"');
    expect(css).toMatch(
      /\.assignment-details \.meta-tag\s*\{[^}]*min-height:\s*28px;[^}]*line-height:\s*1;/,
    );
  });

  it("stacks score and timeline before the student card can overflow", () => {
    expect(css).toMatch(
      /@media \(max-width: 960px\)[\s\S]*?\.student-card-score-line\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /\.student-card-score-line \.activity-status-timeline\s*\{[^}]*width:\s*100%;[^}]*justify-self:\s*stretch;/,
    );
  });

  it("shows an existing student's code inside one modal level", () => {
    expect(studentManager).toContain(
      'shownCode ? "student-detail-dialog--code" : ""',
    );
    expect(studentManager).toContain("shownCode && !selectedStudent");
    expect(studentManager).toContain("finishClosingCodeDialog");
    expect(studentManager).toContain("onCancel={(event) => {");
    expect(css).toMatch(
      /\.modal-frame\.student-detail-dialog--code\[open\]\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /\.student-code-dialog-body \.dialog-code\s*\{[^}]*margin:\s*0;/,
    );
  });
});
