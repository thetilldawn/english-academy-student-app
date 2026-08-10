import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("assignment editor UI contract", () => {
  const css = source("src/app/globals.css");
  const shared = source("src/components/assignment-editor-ui.tsx");
  const single = source("src/components/assignment-manager.tsx");
  const bulk = source("src/components/bulk-assignment-dialog.tsx");
  const review = source("src/components/review-assignment-dialog.tsx");

  it("uses one responsive settings and summary layout", () => {
    expect(shared).toContain("AssignmentEditorLayout");
    expect(shared).toContain("AssignmentEditorSettings");
    expect(shared).toContain("AssignmentEditorSummary");
    expect(shared).toContain("AssignmentFieldGrid");
    expect(shared).toContain("AssignmentSessionRow");
    expect(single).toContain("<AssignmentEditorLayout>");
    expect(single).toContain("<AssignmentEditorSummary>");
    expect(bulk).toContain("<AssignmentEditorLayout>");
    expect(bulk).toContain("<AssignmentEditorSummary");
    expect(css).toMatch(
      /\.assignment-editor-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 0\.44fr\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 960px\)\s*\{[^}]*\.assignment-editor-layout,[^}]*grid-template-columns:\s*1fr;/,
    );
  });

  it("leaves modal scrolling and spacing to ModalBody", () => {
    const bulkFormRule =
      css.match(/\.bulk-assignment-form\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bulkFormRule).not.toContain("padding:");
    expect(bulkFormRule).not.toContain("overflow:");
    expect(css).not.toContain(".bulk-assignment-form > .dialog-actions");
  });

  it("does not retain dead student-row grid authorities", () => {
    expect(css).not.toContain(".assignment-student-select");
    expect(css).not.toContain(".assignment-student-actions");
    expect(css).not.toContain(".assignment-student-next");
    expect(css).not.toContain("var(--danger)");
    expect(css).not.toContain("var(--surface-soft)");
  });

  it("uses one normally-flowing timing control in every assignment editor", () => {
    expect(shared).toContain("AssignmentTimingModeField");
    expect(shared).toContain("ariaLabelledBy={labelId}");
    expect(shared).toContain("<SegmentedControl");
    expect(shared).not.toContain('className="segmented-control"');
    for (const editor of [single, bulk, review]) {
      expect(editor).toContain("<AssignmentTimingModeField");
      expect(editor).not.toContain(
        '<fieldset className="field timing-mode-field">',
      );
    }
  });

  it("keeps a new vocabulary assignment action available after activity exists", () => {
    const studentManager = source("src/components/student-manager.tsx");

    expect(single).toContain("adminLearningText.page.studentCard.newAssignment");
    expect(single).toContain('selectStudent(student.id, "assign")');
    expect(
      studentManager.match(/<StudentVocabularyAssignmentAction/g),
    ).toHaveLength(2);
    expect(studentManager).toContain("openStudentAssignment({");
  });
});
