import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student progress history source contract", () => {
  it("keeps complete history for planning while admin directory reads its own compact model", () => {
    const assignmentManager = source("src/lib/services/assignment-manager-data.ts");
    const bulkAssignments = source("src/lib/services/bulk-assignment-service.ts");
    const directoryQuery = source("src/features/students/server/queries/student-directory-query.ts");

    expect(assignmentManager).toMatch(
      /progress:\s*buildStudentProgress\([\s\S]*?historyBundle\.completeHistory[\s\S]*?\),/,
    );
    expect(bulkAssignments).toMatch(
      /buildStudentProgress\(students, units, historyBundle\.completeHistory\)/,
    );
    expect(bulkAssignments).toMatch(
      /listAssignmentHistoryBundle\(\{[\s\S]*?reuseMaterialRequestCache:\s*false,[\s\S]*?\}\)/,
    );
    expect(assignmentManager).toMatch(
      /listAssignmentHistoryBundle\(\{[\s\S]*?reuseMaterialRequestCache:\s*options\?\.reuseMaterialRequestCache\s*\?\?\s*true,[\s\S]*?\}\)/,
    );
    expect(directoryQuery).toContain('"get_admin_student_directory_initial_v1"');
    expect(directoryQuery).not.toContain("listAssignmentHistoryBundle");
    expect(bulkAssignments).not.toContain("finalizeStale");
    expect(assignmentManager).not.toContain("finalizeStale");
  });

  it("keeps shared planning catalogs in assignment workflows only", () => {
    const assignmentManager = source("src/lib/services/assignment-manager-data.ts");
    const bulkAssignments = source("src/lib/services/bulk-assignment-service.ts");
    const studentPage = source("src/app/admin/(protected)/students/page.tsx");

    expect(assignmentManager).toContain("loadStudentDirectoryBundle()");
    expect(bulkAssignments).toContain("loadAssignmentPlanningCatalog()");
    expect(studentPage).not.toContain("loadStudentDirectoryBundle");
    expect(studentPage).not.toContain("loadAssignmentPlanningCatalog");

    for (const workflow of [assignmentManager, bulkAssignments]) {
      expect(workflow).not.toMatch(
        /\blistStudents\(\)|\blistDatasets\(\)|\blistVocabUnits\(\)|\blistStudentLearningSources\(\)/,
      );
    }
  });
});
