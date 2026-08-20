import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student progress history source contract", () => {
  it("keeps admin-hidden history out of lists but not out of progress", () => {
    const studentManagement = source(
      "src/features/students/server/load-student-management-data.ts",
    );
    const assignmentManager = source(
      "src/lib/services/assignment-manager-data.ts",
    );
    const bulkAssignments = source(
      "src/lib/services/bulk-assignment-service.ts",
    );

    expect(studentManagement).toMatch(
      /progress:\s*buildStudentProgress\([\s\S]*?historyBundle\.completeHistory[\s\S]*?\),/,
    );
    expect(assignmentManager).toMatch(
      /progress:\s*buildStudentProgress\([\s\S]*?historyBundle\.completeHistory[\s\S]*?\),/,
    );
    expect(bulkAssignments).toMatch(
      /buildStudentProgress\(students, units, historyBundle\.completeHistory\)/,
    );
    expect(bulkAssignments).toContain(
      "listAssignmentHistoryBundle({ finalizeStale: false })",
    );
    expect(assignmentManager).toContain(
      "listAssignmentHistoryBundle({ finalizeStale: false })",
    );
  });
});
