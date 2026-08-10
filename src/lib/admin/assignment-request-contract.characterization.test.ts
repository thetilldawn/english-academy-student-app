import { describe, expect, it } from "vitest";

import { resolveBulkAssignmentSeries } from "@/lib/admin/bulk-assignment-range";
import { resolveBulkAssignmentSchedule } from "@/lib/admin/bulk-assignment-schedule";
import { buildAssignmentSubmission } from "@/lib/admin/assignment-submission";
import {
  assignmentCapacitySchema,
  assignmentReplacementPreviewSchema,
  assignmentReplacementSchema,
  assignmentSchema,
  bulkAssignmentPreviewSchema,
  bulkAssignmentSchema,
  mixedAssignmentPreviewSchema,
  mixedAssignmentSchema,
} from "@/lib/validation";
import {
  assignmentContractIds,
  bulkPreviewContract,
  bulkSubmitContract,
  forwardUnitIds,
  mixedPerQuestionContract,
  orderedBulkUnits,
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

  it("일괄 역방향 2 DAY씩 2회와 날짜 간격을 손실 없이 계산한다", () => {
    const series = resolveBulkAssignmentSeries(
      mutable(orderedBulkUnits),
      {
        recommendedUnitIds: [
          assignmentContractIds.day60,
          assignmentContractIds.day59,
        ],
        recommendedDirection: -1,
      },
      "previous_span",
      2,
      2,
    );
    const schedule = resolveBulkAssignmentSchedule({
      sessionCount: 2,
      firstAvailableFrom: bulkPreviewContract.firstAvailableFrom,
      firstAvailableUntil: bulkPreviewContract.firstAvailableUntil,
      dayInterval: bulkPreviewContract.dayInterval,
    });

    expect(series.direction).toBe(-1);
    expect(
      series.sessions.map((session) =>
        session.units.map((unit) => unit.id),
      ),
    ).toStrictEqual([
      [assignmentContractIds.day60, assignmentContractIds.day59],
      [assignmentContractIds.day58, assignmentContractIds.day57],
    ]);
    expect(schedule).toStrictEqual([
      {
        sessionNumber: 1,
        availableFrom: "2026-08-17T00:00:00.000Z",
        availableUntil: "2026-08-17T12:00:00.000Z",
      },
      {
        sessionNumber: 2,
        availableFrom: "2026-08-19T00:00:00.000Z",
        availableUntil: "2026-08-19T12:00:00.000Z",
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
    ).toThrow("같은 DAY를 두 번 선택할 수 없습니다.");
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
