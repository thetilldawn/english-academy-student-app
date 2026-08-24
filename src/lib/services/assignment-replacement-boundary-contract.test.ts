import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("assignment replacement responsibility boundaries", () => {
  it("keeps source loading, preparation, and persistence in one direction", () => {
    const sourceService = source(
      "src/lib/services/assignment-edit-source-service.ts",
    );
    const preparationService = source(
      "src/lib/services/assignment-replacement-preparation-service.ts",
    );
    const persistenceService = source(
      "src/lib/services/assignment-replacement-service.ts",
    );

    expect(sourceService).not.toContain(
      "assignment-replacement-preparation-service",
    );
    expect(sourceService).not.toContain("replace_student_assignment_v5");

    expect(preparationService).toContain(
      "requireEditableSourceContext",
    );
    expect(preparationService).toContain("prepareRegularAssignment");
    expect(preparationService).toContain("prepareMixedAssignmentBatch");
    expect(preparationService).not.toContain(
      "replace_student_assignment_v5",
    );

    expect(persistenceService).toContain(
      "prepareStudentAssignmentReplacement",
    );
    expect(persistenceService).toContain("replace_student_assignment_v5");
    expect(persistenceService).not.toContain(
      "requireEditableSourceContext",
    );
    expect(persistenceService).not.toContain("prepareRegularAssignment");
    expect(persistenceService).not.toContain("prepareMixedAssignmentBatch");
  });
});
