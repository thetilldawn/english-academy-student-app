import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("assignment edit UI contract", () => {
  it("학생 모달과 학습 관리가 같은 수정 action과 폼을 사용한다", () => {
    const actions = source("src/components/admin-history-actions.tsx");
    const activities = source(
      "src/components/student-learning-activity-list.tsx",
    );
    const students = source("src/components/student-manager.tsx");
    const manager = source("src/components/assignment-manager.tsx");

    expect(actions).toContain("isStudentAssignmentEditable(item)");
    expect(actions).toContain("onEdit(item)");
    expect(activities).toContain("onEdit={onEditAssignment}");
    expect(students).toContain("initialEditTarget={assignmentEditTarget}");
    expect(manager).toContain("function beginEdit(");
    expect(manager).toContain('method: "PUT"');
    expect(manager).toContain("assignmentEditChangeKeys(");
    expect(manager).toContain(
      "adminLearningText.assignmentModal.edit.comparisonAria",
    );
  });

  it("편집 자기 자신만 capacity 중복 잠금에서 제외한다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const active = source(
      "src/lib/services/active-review-assignment-service.ts",
    );
    const service = source(
      "src/lib/services/assignment-replacement-service.ts",
    );

    expect(manager).toContain("studentAssignmentUrl(");
    expect(active).toContain("exclusion?.studentId === studentId");
    expect(active).toContain(
      '`assignment_id.neq.${exclusion.assignmentId},student_id.neq.${exclusion.studentId}`',
    );
    expect(service).toContain("await requireEditableSourceContext(");
    expect(service).toContain("const exclusion = { assignmentId, studentId }");
  });

  it("정확 오답 재시험은 1문항부터 허용하고 대상 구성은 잠근다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const service = source(
      "src/lib/services/assignment-replacement-service.ts",
    );

    expect(manager).toContain(
      'editDraft?.purpose === "review" ? 1 : 4',
    );
    expect(manager).toContain("const exactReviewEdit =");
    expect(manager).toContain("disabled={exactReviewEdit}");
    expect(manager).toContain("readOnly={exactReviewEdit}");
    expect(service).toContain("assertExactReviewShape(source, input)");
    expect(service).toContain(
      'input.englishToKoreanRatio ===\n        source.draft.englishToKoreanRatio',
    );
  });

  it("동일 payload 재전송에 같은 idempotency key를 유지한다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const service = source(
      "src/lib/services/assignment-replacement-service.ts",
    );

    expect(manager).toContain("editIdempotencyRef.current.fingerprint");
    expect(manager).toContain("crypto.randomUUID()");
    expect(service).toContain(
      '"get_student_assignment_replacement_result_v1"',
    );
    expect(service.indexOf("get_student_assignment_replacement_result_v1"))
      .toBeLessThan(service.indexOf("prepareMixedAssignmentBatch("));
  });
});
