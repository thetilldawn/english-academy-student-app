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
  const info = source("src/features/students/ui/panels/student-info-panel.tsx");
  const account = source(
    "src/features/students/ui/panels/student-account-panel.tsx",
  );
  const wrongCss = source(
    "src/features/students/ui/panels/student-wrong-word-panel.module.css",
  );
  const globalCss = source("src/app/globals.css");

  it("keeps word assignment out of student detail and separates info from account actions", () => {
    expect(detail.match(/<DialogFrame/g)).toHaveLength(1);
    expect(detail).toContain("<StudentInfoPanel");
    expect(detail).not.toMatch(/StudentAssignmentPanel|StudentLearningPanel/);
    expect(info).toMatch(/saveProfile|saveCurrentDataset/);
    expect(account).toMatch(/revealCode|rotateCode|blockAccess|removeStudent/);
    expect(account).not.toMatch(/saveProfile|saveCurrentDataset/);
  });

  it("uses the dedicated activity summary instead of a score timeline", () => {
    expect(directory).toContain("summarizeStudentDirectoryActivities");
    expect(directory).toContain("summary.completedCount");
    expect(directory).toContain("summary.missedCount");
    expect(directory).toContain("summary.notStartedCount");
    expect(directory).not.toContain("AttemptScoreSummary");
    expect(directory).not.toContain("ActivityStatusTimeline");
  });

  it("keeps long names and wrong-word rows inside 320 through 1440 pixels", () => {
    expect(directoryCss).toMatch(
      /\.card\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/,
    );
    expect(directoryCss).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.card\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(directoryCss).toMatch(
      /@media \(max-width: 359px\)[\s\S]*?\.primarySource\s*\{[^}]*overflow-wrap:\s*anywhere;/,
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
    const studentReadService = source(
      "src/lib/services/admin-student-read-service.ts",
    );
    const materialReadService = source(
      "src/lib/services/admin-material-read-service.ts",
    );

    expect(page).toContain("loadStudentManagementData()");
    expect(page).not.toMatch(
      /listStudents\(|listDatasets\(|listSelectableDatasets\(|listStudentLearningSources\(/,
    );
    expect(loader).toContain("loadStudentDirectoryBundle()");
    expect(loader).toContain("getAppOrigin()");
    expect(loader).not.toContain("getServerEnvironment");
    expect(studentReadService).toContain(
      "export async function loadStudentDirectoryBundle",
    );
    expect(studentReadService).toContain("loadAdminMaterialSnapshot(supabase)");
    expect(materialReadService).toContain("toSelectableDatasetOptions(allDatasets)");
    expect(materialReadService).toContain('dataset.status === "ready"');
    expect(materialReadService).toContain("dataset.isActive");
    expect(materialReadService).toContain("dataset.isAssignable");
  });

  it("keeps retired student selectors out of the global cascade", () => {
    expect(globalCss).not.toMatch(
      /\.(?:student-card|student-dialog-|student-learning-|student-code-|wrong-word-)/,
    );
  });
});
