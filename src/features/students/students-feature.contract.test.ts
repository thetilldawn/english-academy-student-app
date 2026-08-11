import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student management feature boundary", () => {
  const directory = source("src/features/students/ui/student-directory.tsx");
  const directoryCss = source(
    "src/features/students/ui/student-directory.module.css",
  );
  const detail = source("src/features/students/ui/student-detail-dialog.tsx");
  const assignment = source(
    "src/features/students/ui/panels/student-assignment-panel.tsx",
  );
  const assignmentEditor = source(
    "src/features/assignments/ui/single-assignment-editor.tsx",
  );
  const assignmentEditorCss = source(
    "src/features/assignments/ui/single-assignment-editor.module.css",
  );
  const dialogCss = source(
    "src/design-system/primitives/dialog/dialog.module.css",
  );
  const wrongCss = source(
    "src/features/students/ui/panels/student-wrong-word-panel.module.css",
  );
  const globalCss = source("src/app/globals.css");

  it("uses one dialog and the focused assignment editor instead of nesting managers", () => {
    expect(detail.match(/<DialogFrame/g)).toHaveLength(1);
    expect(detail).toContain("<StudentAssignmentPanel");
    expect(assignment).toContain("<SingleAssignmentEditor");
    expect(`${detail}\n${assignment}`).not.toMatch(
      /AssignmentManager|launcherOnly/,
    );
  });

  it("keeps the mobile assignment form inside the shared scroll region", () => {
    expect(assignment).toContain('placement="dialog"');
    expect(assignmentEditor).toContain(
      'className={placement === "inline" ? styles.inlineBody : undefined}',
    );
    expect(assignmentEditorCss).not.toMatch(
      /\.dialogBody\s*\{[^}]*overflow:\s*visible/,
    );
    expect(dialogCss).toMatch(
      /\.body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/,
    );
  });

  it("does not reserve a score column when an activity has no score", () => {
    expect(directory).toContain("hasAttemptScoreContent(");
    expect(directory).toContain("{hasScore ? (");
    expect(directoryCss).toMatch(
      /\.scoreLine\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(directoryCss).toMatch(
      /\.scoreLine\[data-has-score="true"\]\s*\{[^}]*grid-template-columns:\s*minmax\(80px, auto\) minmax\(0, 1fr\);/,
    );
  });

  it("keeps long names and wrong-word rows inside 320 through 1440 pixels", () => {
    expect(directoryCss).toMatch(
      /\.card\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/,
    );
    expect(directoryCss).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.card\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(directoryCss).toMatch(
      /@media \(max-width: 359px\)[\s\S]*?\.primarySource,[\s\S]*?overflow-wrap:\s*anywhere;/,
    );
    expect(wrongCss).toMatch(
      /@media \(max-width: 960px\)[\s\S]*?\.row\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/,
    );
    expect(wrongCss).toMatch(
      /@media \(max-width: 359px\)[\s\S]*?\.row\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
  });

  it("loads the student page through one feature server boundary", () => {
    const page = source("src/app/admin/(protected)/students/page.tsx");
    const loader = source(
      "src/features/students/server/load-student-management-data.ts",
    );
    const service = source("src/lib/services/admin-service.ts");

    expect(page).toContain("loadStudentManagementData()");
    expect(page).not.toMatch(
      /listStudents\(|listDatasets\(|listSelectableDatasets\(|listStudentLearningSources\(/,
    );
    expect(loader).toContain("loadStudentDirectoryBundle()");
    expect(service).toContain("export async function loadStudentDirectoryBundle");
    expect(service).toContain("toSelectableDatasetOptions(allDatasets)");
    expect(service).toContain('dataset.status === "ready"');
    expect(service).toContain("dataset.isActive");
    expect(service).toContain("dataset.isAssignable");
  });

  it("keeps retired student selectors out of the global cascade", () => {
    expect(globalCss).not.toMatch(
      /\.(?:student-card|student-dialog-|student-learning-|student-code-|wrong-word-)/,
    );
  });
});
