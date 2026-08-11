import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("assignment edit UI contract", () => {
  it("opens the shared single editor from detail and delegates PUT to its controller", () => {
    const detailActions = source("src/components/history-detail-actions.tsx");
    const activities = source(
      "src/features/history/ui/student-learning-activity-list.tsx",
    );
    const manager = source("src/components/assignment-manager.tsx");
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );
    const adapter = source("src/features/assignments/api/request-adapters.ts");
    const comparison = source(
      "src/features/assignments/ui/assignment-edit-comparison.tsx",
    );

    expect(activities).not.toContain("onEditAssignment");
    expect(detailActions).toContain("isStudentAssignmentEditable(item)");
    expect(detailActions).toContain('initialDialogView="assign"');
    expect(manager).toContain("<SingleAssignmentEditor");
    expect(controller).toContain("hydrateSingleAssignmentDraftFromEditResponse");
    expect(adapter).toContain('method: "PUT"');
    expect(comparison).toContain("comparisonAria");
  });

  it("uses the replacement capacity endpoint so only the edited assignment is excluded", () => {
    const adapter = source("src/features/assignments/api/request-adapters.ts");
    const active = source("src/lib/services/active-review-assignment-service.ts");
    const service = source("src/lib/services/assignment-replacement-service.ts");

    expect(adapter).toContain(
      "`/api/admin/assignments/${draft.operation.assignmentId}/students/${draft.operation.targetStudentId}`",
    );
    expect(active).toContain("exclusion?.studentId === studentId");
    expect(service).toContain("const exclusion = { assignmentId, studentId }");
  });

  it("locks exact-review identity and count in the domain and UI", () => {
    const reducer = source("src/features/assignments/domain/single-draft.ts");
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );
    const range = source(
      "src/features/assignments/ui/assignment-range-fields.tsx",
    );
    const settings = source(
      "src/features/assignments/ui/assignment-settings-fields.tsx",
    );
    const service = source("src/lib/services/assignment-replacement-service.ts");

    expect(controller).toContain("isExactReviewEdit");
    expect(controller).toContain("? 1 : 4");
    expect(reducer).toContain("isExactReviewReplacement(draft)");
    expect(range).toContain("disabled={isExactReview}");
    expect(settings).toContain("readOnly={isExactReview}");
    expect(service).toContain("assertExactReviewShape(source, input)");
  });

  it("reserves one idempotency key per replacement fingerprint", () => {
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );
    const fingerprint = source("src/features/assignments/domain/fingerprint.ts");
    const service = source("src/lib/services/assignment-replacement-service.ts");

    expect(controller).toContain("replacementSubmissionFingerprint(");
    expect(controller).toContain("reserveIdempotencyKey(");
    expect(fingerprint).toContain("current?.fingerprint === fingerprint");
    expect(service).toContain('"get_student_assignment_replacement_result_v1"');
  });
});
