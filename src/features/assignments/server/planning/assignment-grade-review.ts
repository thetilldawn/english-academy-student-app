import "server-only";
import { createHash } from "node:crypto";
import type { AssignmentGradeReview } from "../../contracts/assignment-grade-review";
import type { BulkAssignmentInput, BulkAssignmentPreviewInput } from "../../contracts/bulk-assignment-request";
import { assignmentAudienceMode, assignmentGradeLabel, compareAssignmentGrades } from "../../domain/assignment-grade-review";
import type { CommonBulkAssignmentPlanningData } from "../queries/bulk-assignment-planning-query";
import { BulkAssignmentError } from "../use-cases/bulk-assignment-errors";

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

export function buildAssignmentGradeReview(input: BulkAssignmentPreviewInput, planning: CommonBulkAssignmentPlanningData): AssignmentGradeReview {
  const studentIds = [...input.studentIds].toSorted();
  const byId = new Map(planning.students.map(s => [s.id, s]));
  const students = studentIds.map(id => ({ id, gradeLabel: byId.get(id)?.gradeLabel ?? null }));
  const compared = compareAssignmentGrades(planning.dataset?.gradeCode, students);
  const audienceMode = assignmentAudienceMode(input.audienceMode, input.studentIds.length);
  return {
    audienceMode,
    datasetId: input.commonPlan.datasetId,
    datasetGrade: assignmentGradeLabel(compared.grade),
    studentIds,
    mismatches: compared.mismatchedStudentIds.map(studentId => ({
      studentId, displayName: byId.get(studentId)?.displayName ?? "확인할 수 없는 학생",
      gradeLabel: byId.get(studentId)?.gradeLabel ?? null,
    })),
    unknownStudentIds: compared.unknownStudentIds,
    // An equality proof of reviewed inputs, not an authorization token.
    token: sha256({ version: 1, audienceMode, datasetId: input.commonPlan.datasetId,
      datasetGrade: planning.dataset?.gradeCode ?? null, studentIds,
      students: students.map(s => ({ ...s, displayName: byId.get(s.id)?.displayName ?? null })),
      mismatchedStudentIds: compared.mismatchedStudentIds }),
  };
}

export function bindAssignmentGradeReview(planSignature: string, review: AssignmentGradeReview): string {
  return sha256({ planSignature, gradeReviewToken: review.token });
}

export function assertAssignmentGradeAcknowledged(input: BulkAssignmentInput, review: AssignmentGradeReview | undefined): void {
  if (!review) {
    if (input.audienceMode) throw new BulkAssignmentError("database", "학년 확인 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
    return;
  }
  if ((input.gradeReviewToken && input.gradeReviewToken !== review.token) ||
      (review.audienceMode === "bulk" && review.mismatches.length > 0 && input.gradeReviewToken !== review.token)) {
    throw new BulkAssignmentError("conflict", input.audienceMode
      ? "학생이나 단어장 정보가 바뀌었습니다. 학년이 다른 학생의 포함 여부를 다시 확인해 주세요."
      : "학년이 다른 학생이 있습니다. 배정 창을 새로 열어 포함 여부를 확인해 주세요.");
  }
}
