import { describe, expect, it } from "vitest";

import {
  bulkAssignmentPreviewSchema,
  bulkAssignmentSchema,
} from "@/features/assignments/contracts/bulk-assignment-request";
import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import {
  buildBulkAssignmentPreviewRequest,
  buildBulkAssignmentRequest,
} from "./api/request-adapters";
import {
  resolveVocabAssignmentMode,
  type VocabWeekdayUnitCounts,
} from "./domain/vocab-assignment-contract";
import type { BulkSeriesAssignmentDraft } from "./domain/model";
import { resolveVocabBaseSessionUnitCounts } from "./domain/vocab-schedule";
import { resolveVocabUnitCycleAllocation } from "./domain/vocab-unit-allocation";

const NOW = Date.parse("2026-08-10T00:00:00.000Z");
const unitIds = Array.from(
  { length: 8 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
);
const weekdayUnitsPerSession: VocabWeekdayUnitCounts = {
  1: 2,
  2: 1,
  3: 3,
  4: 1,
  5: 1,
  6: 1,
  7: 1,
};
const recurrenceSlots = [
  {
    sessionNumber: 1,
    date: "2026-08-24",
    availableLocalDateTime: "2026-08-24T00:00",
    deadlineLocalDateTime: "2026-08-24T22:00",
  },
  {
    sessionNumber: 2,
    date: "2026-08-26",
    availableLocalDateTime: "2026-08-26T00:00",
    deadlineLocalDateTime: "2026-08-26T22:00",
  },
] as const;

// R2-0은 현재 하위 계층이 서로 다른 실제 단위 수를 운반하는 범위만 고정한다.
// 현재 요청에 없는 same/by_weekday 원 규칙과 UI→상태 연결은 R2-3에서 별도로 검증한다.
function buildWeekdayDraft(
  studentIds: readonly string[],
): BulkSeriesAssignmentDraft {
  const rangeUnitCounts = resolveVocabBaseSessionUnitCounts({
    slots: recurrenceSlots,
    mode: "by_weekday",
    unitsPerSession: 1,
    weekdayUnitsPerSession,
  });
  const allocation = resolveVocabUnitCycleAllocation({
    orderedUnitIds: unitIds,
    baseSessionUnitCounts: rangeUnitCounts,
    selectedDateCount: recurrenceSlots.length,
    overflowPolicy: "continue_weekly",
    extraDatePolicy: "unconfirmed",
  });
  const sessionDates = [
    "2026-08-24",
    "2026-08-26",
    "2026-08-31",
    "2026-09-02",
  ];

  if (allocation.issue) {
    throw new Error(`테스트 배정 계산 실패: ${allocation.issue}`);
  }

  return {
    kind: "bulk_series",
    questionMode: "book_meaning_choice",
    studentIds,
    exam: {
      directionRatio: 50,
      questionOrderMode: "ascending",
      passingScore: 80,
      retryEnabled: true,
      retryPassingScore: 80,
      timing: { mode: "total", totalSeconds: 300 },
    },
    commonPlan: {
      datasetId: assignmentContractIds.dataset,
      distribution: "split",
      splitBasis: "range_unit",
      orderedUnitIds: unitIds,
      rangeUnitCounts,
      unitAllocationRule: {
        schemaVersion: 1,
        mode: "by_weekday",
        unitsPerSession: 1,
        weekdayUnitsPerSession,
      },
      questionCount: { mode: "all" },
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: recurrenceSlots.length,
      selectionMode: "source_order",
      planNonce: assignmentContractIds.idempotencyKey,
      recurrenceSessions: recurrenceSlots.map((slot) => ({
        availableLocalDateTime: slot.availableLocalDateTime,
        deadlineLocalDateTime: slot.deadlineLocalDateTime,
      })),
      sessions: allocation.sessionUnitIds.map((sessionUnitIds, index) => ({
        unitIds: sessionUnitIds,
        availableLocalDateTime: `${sessionDates[index]}T00:00`,
        deadlineLocalDateTime: `${sessionDates[index]}T22:00`,
      })),
    },
  };
}

describe("R2 배정 공통 흐름 특성화", () => {
  it("화면의 세 회차 배정 방식을 서로 다른 저장 의미로 유지한다", () => {
    expect(resolveVocabAssignmentMode("all_sessions")).toEqual({
      distribution: "repeat",
      splitBasis: "question_count",
    });
    expect(resolveVocabAssignmentMode("per_session")).toEqual({
      distribution: "split",
      splitBasis: "range_unit",
    });
    expect(resolveVocabAssignmentMode("word_count")).toEqual({
      distribution: "split",
      splitBasis: "question_count",
    });
  });

  it("월 2단위·수 3단위를 하위 계산부터 Preview·저장 요청까지 보존한다", () => {
    const draft = buildWeekdayDraft([assignmentContractIds.studentA]);
    const preview = buildBulkAssignmentPreviewRequest(draft);
    const submission = buildBulkAssignmentRequest(
      draft,
      assignmentContractIds.idempotencyKey,
      NOW,
      assignmentContractIds.previewPlanSignature,
    );

    expect(draft.commonPlan?.rangeUnitCounts).toEqual([2, 3]);
    expect(draft.commonPlan?.sessions.map((session) => session.unitIds)).toEqual([
      unitIds.slice(0, 2),
      unitIds.slice(2, 5),
      unitIds.slice(5, 7),
      unitIds.slice(7, 8),
    ]);
    expect(preview.endpoint).toBe("/api/admin/bulk-assignments/preview");
    expect(submission.endpoint).toBe("/api/admin/bulk-assignments");
    expect(submission.body.commonPlan).toStrictEqual(preview.body.commonPlan);
    expect(bulkAssignmentPreviewSchema.parse(preview.body)).toStrictEqual(
      preview.body,
    );
    expect(bulkAssignmentSchema.parse(submission.body)).toStrictEqual(
      submission.body,
    );
  });

  it("한 명과 여러 명의 일반 배정이 같은 Preview·저장 경계를 사용한다", () => {
    const single = buildWeekdayDraft([assignmentContractIds.studentA]);
    const bulk = buildWeekdayDraft([
      assignmentContractIds.studentA,
      assignmentContractIds.studentB,
    ]);
    const singlePreview = buildBulkAssignmentPreviewRequest(single);
    const bulkPreview = buildBulkAssignmentPreviewRequest(bulk);
    const singleSubmission = buildBulkAssignmentRequest(
      single,
      assignmentContractIds.idempotencyKey,
      NOW,
      assignmentContractIds.previewPlanSignature,
    );
    const bulkSubmission = buildBulkAssignmentRequest(
      bulk,
      assignmentContractIds.idempotencyKey,
      NOW,
      assignmentContractIds.previewPlanSignature,
    );

    expect(singlePreview.endpoint).toBe(bulkPreview.endpoint);
    expect(singleSubmission.endpoint).toBe(bulkSubmission.endpoint);
    expect(singlePreview.body.commonPlan).toStrictEqual(
      bulkPreview.body.commonPlan,
    );
    expect(singlePreview.body.studentIds).toEqual([
      assignmentContractIds.studentA,
    ]);
    expect(bulkPreview.body.studentIds).toEqual([
      assignmentContractIds.studentA,
      assignmentContractIds.studentB,
    ]);
  });
});
