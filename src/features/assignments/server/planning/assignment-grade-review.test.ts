import { describe, expect, it, vi } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import { assignmentContractIds as ids, bulkImmediateSubmitContract } from "@/test-support/assignment-contract-fixtures";
import { assignmentGradeReviewSchema } from "../../contracts/assignment-grade-review";
import { bulkAssignmentSchema, bulkAssignmentPreviewSchema } from "../../contracts/bulk-assignment-request";
import type { CommonBulkAssignmentPlanningData } from "../queries/bulk-assignment-planning-query";
vi.mock("server-only", () => ({}));
import { assertAssignmentGradeAcknowledged, bindAssignmentGradeReview, buildAssignmentGradeReview } from "./assignment-grade-review";

function setup(mode: "single" | "bulk" | undefined = "bulk") {
  const input = bulkAssignmentSchema.parse({ ...bulkImmediateSubmitContract, audienceMode: mode });
  const planning: CommonBulkAssignmentPlanningData = {
    dataset: { ...cataloguedDatasetFromMetadata({ id: ids.dataset, title: "가짜 고1 단어장" }, undefined),
      datasetKey: "synthetic-grade-review", gradeCode: "h1", isActive: true, rowCount: 10, status: "ready" },
    students: [{ id: ids.studentA, displayName: "가짜 학생", gradeLabel: "고2", status: "active", currentVocabDatasetId: null }], units: [],
  };
  return { input, planning, review: buildAssignmentGradeReview(input, planning) };
}

describe("저장 직전 학년 확인", () => {
  it("단일은 다른 학년도 허용하고 일괄 1명은 확인해야 한다", () => {
    const single = setup("single");
    expect(() => assertAssignmentGradeAcknowledged(single.input, single.review)).not.toThrow();
    const bulk = setup();
    expect(() => assertAssignmentGradeAcknowledged(bulk.input, bulk.review)).toThrow("포함 여부");
    expect(() => assertAssignmentGradeAcknowledged({ ...bulk.input, gradeReviewToken: bulk.review.token }, bulk.review)).not.toThrow();
    expect(assignmentGradeReviewSchema.parse(bulk.review)).toEqual(bulk.review);
  });
  it("옛 단일 요청을 보존하되 옛 일괄의 미확인 차이는 새 창으로 안내한다", () => {
    const { input, planning } = setup("single");
    delete input.audienceMode;
    const review = buildAssignmentGradeReview(input, planning);
    expect(() => assertAssignmentGradeAcknowledged(input, review)).not.toThrow();
    const legacyBulk = { ...input, studentIds: [ids.studentA, ids.studentB] };
    expect(() => assertAssignmentGradeAcknowledged(legacyBulk, buildAssignmentGradeReview(legacyBulk, planning))).toThrow("배정 창을 새로");
  });
  it.each(["student-grade", "dataset-grade", "dataset", "students", "mode"])("%s 변경 후 이전 확인을 쓰지 않는다", change => {
    const { input, planning, review } = setup();
    if (change === "student-grade") planning.students[0]!.gradeLabel = "고3";
    if (change === "dataset-grade") planning.dataset!.gradeCode = "h2";
    if (change === "dataset") input.commonPlan.datasetId = ids.day57;
    if (change === "students") input.studentIds.push(ids.studentB);
    if (change === "mode") input.audienceMode = "single";
    const next = buildAssignmentGradeReview(input, planning);
    expect(next.token).not.toBe(review.token);
    expect(bindAssignmentGradeReview("a".repeat(64), next)).not.toBe(bindAssignmentGradeReview("a".repeat(64), review));
    expect(() => assertAssignmentGradeAcknowledged({ ...input, gradeReviewToken: review.token }, next)).toThrow("다시 확인");
  });
  it("학년 미입력은 다른 학년으로 간주하지 않으며 조회 실패를 통과시키지 않는다", () => {
    const { input, planning } = setup();
    planning.students[0]!.gradeLabel = null;
    const review = buildAssignmentGradeReview(input, planning);
    expect(review.mismatches).toEqual([]);
    expect(review.unknownStudentIds).toEqual(input.studentIds);
    expect(() => assertAssignmentGradeAcknowledged(input, review)).not.toThrow();
    expect(() => assertAssignmentGradeAcknowledged(input, undefined)).toThrow("불러오지 못했습니다");
  });
  it("같은 대상의 순서만 바뀌면 확인은 유지하고 다중 단일 요청은 거부한다", () => {
    const { input, planning } = setup();
    input.studentIds = [ids.studentA, ids.studentB];
    const review = buildAssignmentGradeReview(input, planning);
    input.studentIds.reverse();
    expect(buildAssignmentGradeReview(input, planning).token).toBe(review.token);
    expect(bulkAssignmentPreviewSchema.safeParse({ ...bulkImmediateSubmitContract, audienceMode: "single", studentIds: input.studentIds }).success).toBe(false);
    expect(assignmentGradeReviewSchema.safeParse({ ...review, mismatches: [...review.mismatches, ...review.mismatches] }).success).toBe(false);
    expect(assignmentGradeReviewSchema.safeParse({ ...review, unknownStudentIds: [ids.day57] }).success).toBe(false);
  });
});
