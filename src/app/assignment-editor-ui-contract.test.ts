import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("assignment editor UI contract", () => {
  const css = source("src/app/globals.css");
  const sharedCss = source("src/components/assignment-editor-ui.module.css");
  const shared = source("src/components/assignment-editor-ui.tsx");
  const single = source(
    "src/features/assignments/ui/single-assignment-editor.tsx",
  );
  const singleSettings = source(
    "src/features/assignments/ui/assignment-settings-fields.tsx",
  );
  const manager = source("src/components/assignment-manager.tsx");
  const bulk = source("src/components/bulk-assignment-dialog.tsx");
  const review = source("src/components/review-assignment-dialog.tsx");

  it("uses one responsive settings and summary layout", () => {
    expect(shared).toContain("AssignmentEditorLayout");
    expect(shared).toContain("AssignmentEditorSettings");
    expect(shared).toContain("AssignmentEditorSummary");
    expect(shared).toContain("AssignmentFieldGrid");
    expect(shared).toContain("AssignmentSessionRow");
    expect(single).toContain("<AssignmentEditorLayout>");
    expect(single).toContain("<AssignmentEditorSummary");
    expect(bulk).toContain("<AssignmentEditorLayout>");
    expect(bulk).toContain("<AssignmentEditorSummary");
    expect(sharedCss).toMatch(
      /\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 0\.44fr\);/,
    );
    expect(sharedCss).toMatch(
      /@media \(max-width: 960px\)\s*\{[^}]*\.layout,[^}]*grid-template-columns:\s*1fr;/,
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
    for (const editor of [singleSettings, bulk, review]) {
      expect(editor).toContain("<AssignmentTimingModeField");
      expect(editor).not.toContain(
        '<fieldset className="field timing-mode-field">',
      );
    }
    expect(single).toContain("<AssignmentSettingsFields");
  });

  it("keeps a new vocabulary assignment action available after activity exists", () => {
    const studentManager = source("src/components/student-manager.tsx");

    expect(manager).toContain("adminLearningText.page.studentCard.newAssignment");
    expect(manager).toContain('selectStudent(student.id, "assign")');
    expect(
      studentManager.match(/<StudentVocabularyAssignmentAction/g),
    ).toHaveLength(2);
    expect(studentManager).toContain("openStudentAssignment({");
  });

  it("explains invalid assignment conditions instead of only disabling submit", () => {
    const summary = source(
      "src/features/assignments/ui/assignment-summary-panel.tsx",
    );

    expect(summary).toContain("...controller.issues.map");
    expect(summary).toContain('role="alert"');
  });
});
