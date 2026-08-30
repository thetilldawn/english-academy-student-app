import { describe, expect, it } from "vitest";

import { buildAssignmentSubmission } from "@/lib/admin/assignment-submission";
import {
  assignmentCapacitySchema,
  assignmentReplacementPreviewSchema,
  assignmentReplacementSchema,
} from "@/lib/admin/assignment-replacement-request";
import {
  bulkAssignmentPreviewSchema,
  bulkAssignmentSchema,
} from "@/features/assignments/contracts/bulk-assignment-request";
import {
  mixedAssignmentPreviewSchema,
  mixedAssignmentSchema,
} from "@/lib/admin/mixed-assignment-request";
import { assignmentSchema } from "@/lib/admin/regular-assignment-request";
import {
  assignmentContractIds,
  bulkImmediatePreviewContract,
  bulkPreviewContract,
  bulkSubmitContract,
  forwardUnitIds,
  mixedPerQuestionContract,
  regularTotalContract,
  replacementPreviewContract,
  replacementSubmitContract,
  reverseUnitIds,
} from "@/test-support/assignment-contract-fixtures";

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function mutable<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

describe("배정 요청 현행 계약 특성화", () => {
  it("역순 일반 시험의 endpoint, body, DAY 순서를 그대로 보존한다", () => {
    const submission = buildAssignmentSubmission(
      mutable(regularTotalContract.input),
    );

    expect(submission).toStrictEqual(
      mutable(regularTotalContract.submission),
    );
    expect(assignmentSchema.parse(submission.body)).toStrictEqual(
      mutable(regularTotalContract.submission.body),
    );
    expect(submission.body.unitIds).toStrictEqual([...reverseUnitIds]);
  });

  it("혼합 시험의 선택 범위, 오답 scope, 문제당 시간 payload를 동일하게 사용한다", () => {
    const submission = buildAssignmentSubmission(
      mutable(mixedPerQuestionContract.input),
    );

    expect(submission).toStrictEqual(
      mutable(mixedPerQuestionContract.submission),
    );
    expect(mixedAssignmentSchema.parse(submission.body)).toStrictEqual(
      mutable(mixedPerQuestionContract.submission.body),
    );
    expect(
      mixedAssignmentPreviewSchema.parse({
        studentId: mixedPerQuestionContract.input.studentId,
        datasetId: mixedPerQuestionContract.input.datasetId,
        primaryUnitIds: [...forwardUnitIds],
        reviewLevels: [1, 2],
        reviewScope: "selection",
        englishToKoreanRatio: 100,
      }),
    ).toStrictEqual({
      studentId: mixedPerQuestionContract.input.studentId,
      datasetId: mixedPerQuestionContract.input.datasetId,
      primaryUnitIds: [...forwardUnitIds],
      reviewLevels: [1, 2],
      reviewScope: "selection",
      englishToKoreanRatio: 100,
    });
  });

  it("capacity와 수정 미리보기가 동일한 역순 범위와 오답 조건을 보존한다", () => {
    const capacity = assignmentCapacitySchema.parse({
      ...mutable(replacementPreviewContract),
    });
    const replacement = assignmentReplacementPreviewSchema.parse(
      mutable(replacementPreviewContract),
    );

    expect(capacity).toStrictEqual(replacement);
    expect(replacement.primaryUnitIds).toStrictEqual([...reverseUnitIds]);
    expect(replacement.reviewLevels).toStrictEqual([2]);
  });

  it("기존 exact review 수정의 1문항과 원래 DAY 순서를 허용한다", () => {
    const parsed = assignmentReplacementSchema.parse(
      mutable(replacementSubmitContract),
    );

    expect(parsed).toStrictEqual(mutable(replacementSubmitContract));
    expect(parsed.questionCount).toBe(1);
    expect(parsed.primaryUnitIds).toStrictEqual([...reverseUnitIds]);
    expect(() =>
      assignmentSchema.parse({
        ...mutable(regularTotalContract.submission.body),
        questionCount: 1,
      }),
    ).toThrow();
  });

  it("일괄 미리보기와 저장이 같은 선택 조건을 공유한다", () => {
    const preview = bulkAssignmentPreviewSchema.parse(
      mutable(bulkPreviewContract),
    );
    const submission = bulkAssignmentSchema.parse(
      mutable(bulkSubmitContract),
    );

    expect(submission).toMatchObject(preview);
    expect(submission.idempotencyKey).toBe(
      assignmentContractIds.idempotencyKey,
    );
  });

  it("일괄 미리보기와 저장이 역순 범위와 회차 일정을 같은 공통 계획으로 보존한다", () => {
    const preview = bulkAssignmentPreviewSchema.parse(
      mutable(bulkPreviewContract),
    );
    const submission = bulkAssignmentSchema.parse(
      mutable(bulkSubmitContract),
    );

    expect(preview.commonPlan.orderedUnitIds).toStrictEqual([
      assignmentContractIds.day60,
      assignmentContractIds.day59,
      assignmentContractIds.day58,
    ]);
    expect(preview.commonPlan.sessions).toStrictEqual([
      {
        unitIds: [...reverseUnitIds],
        availableFrom: "2026-08-16T15:00:00.000Z",
        availableUntil: "2026-08-17T12:00:00.000Z",
      },
      {
        unitIds: [...reverseUnitIds],
        availableFrom: "2026-08-18T15:00:00.000Z",
        availableUntil: "2026-08-19T12:00:00.000Z",
      },
    ]);
    expect(submission.commonPlan).toStrictEqual(preview.commonPlan);
  });

  it("시험일 없는 일괄 배정은 1회 NULL 일정만 허용한다", () => {
    const parsed = bulkAssignmentPreviewSchema.parse(
      mutable(bulkImmediatePreviewContract),
    );
    expect(parsed.commonPlan.selectedDateCount).toBe(0);
    expect(parsed.commonPlan.sessions).toStrictEqual([
      {
        unitIds: [...reverseUnitIds],
        availableFrom: null,
        availableUntil: null,
      },
    ]);
  });

  it("중복 DAY, 빈 오답 단계, 시간 방식 불일치를 경계에서 거부한다", () => {
    expect(() =>
      assignmentCapacitySchema.parse({
        ...mutable(replacementPreviewContract),
        primaryUnitIds: [
          assignmentContractIds.day60,
          assignmentContractIds.day60,
        ],
      }),
    ).toThrow("같은 범위를 두 번 선택할 수 없습니다.");
    expect(() =>
      assignmentCapacitySchema.parse({
        ...mutable(replacementPreviewContract),
        reviewLevels: [],
      }),
    ).toThrow("포함할 오답 단계를 하나 이상 선택해 주세요.");
    expect(() =>
      bulkAssignmentSchema.parse({
        ...mutable(bulkSubmitContract),
        timingMode: "total",
        questionTimeLimitSeconds: 15,
      }),
    ).toThrow("시간 제한 방식과 문제당 시간을 확인해주세요.");
  });

});
