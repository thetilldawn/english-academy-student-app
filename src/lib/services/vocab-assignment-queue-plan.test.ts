import { describe, expect, it } from "vitest";

import { bulkAssignmentSchema } from "@/lib/admin/bulk-assignment-request";
import {
  assignmentContractIds,
  bulkSubmitContract,
} from "@/test-support/assignment-contract-fixtures";

import {
  buildVocabAssignmentQueueSeriesPayload,
  VocabAssignmentQueuePlanError,
} from "./vocab-assignment-queue-plan";

function commonPlan() {
  const first = {
    unitIds: [assignmentContractIds.day57],
    availableFrom: "2026-08-24T07:00:00.000Z",
    availableUntil: "2026-08-25T07:00:00.000Z",
  };
  const second = {
    unitIds: [assignmentContractIds.day57],
    availableFrom: "2026-08-26T08:30:00.000Z",
    availableUntil: "2026-08-27T08:30:00.000Z",
  };
  return bulkAssignmentSchema.parse({
    ...bulkSubmitContract,
    includePendingReview: false,
    commonPlan: {
      datasetId: assignmentContractIds.dataset,
      distribution: "split",
      splitBasis: "question_count",
      orderedUnitIds: [assignmentContractIds.day57],
      rangeUnitCounts: [],
      questionCount: { mode: "manual", value: 4 },
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: 2,
      selectionMode: "source_order",
      planNonce: assignmentContractIds.idempotencyKey,
      recurrenceSessions: [first, second].map((slot) => ({
        availableFrom: slot.availableFrom,
        availableUntil: slot.availableUntil,
      })),
      sessions: [first, second],
      collisionDecisions: [],
    },
  }).commonPlan!;
}

describe("vocab assignment queue plan", () => {
  it("keeps session order and converts recurrence slots to Seoul time", () => {
    const payload = buildVocabAssignmentQueueSeriesPayload({
      commonPlan: commonPlan(),
      rangeLabel: "DAY 57",
      previewItems: [{
        studentId: assignmentContractIds.studentA,
        datasetId: assignmentContractIds.dataset,
        datasetLabel: "검증 단어장",
        sessionCount: 2,
      }],
      batches: [
        {
          student_id: assignmentContractIds.studentA,
          session_number: 2,
        },
        {
          student_id: assignmentContractIds.studentA,
          session_number: 1,
        },
      ],
    });

    expect(payload[0]).toMatchObject({
      student_id: assignmentContractIds.studentA,
      range_label: "DAY 57",
      recurrence_slots: [
        { isodow: 1, local_time: "16:00:00", duration_seconds: 86400 },
        { isodow: 3, local_time: "17:30:00", duration_seconds: 86400 },
      ],
      items: [{ session_number: 1 }, { session_number: 2 }],
    });
  });

  it("rejects a queue whose batch count differs from Preview", () => {
    expect(() => buildVocabAssignmentQueueSeriesPayload({
      commonPlan: commonPlan(),
      rangeLabel: null,
      previewItems: [{
        studentId: assignmentContractIds.studentA,
        datasetId: assignmentContractIds.dataset,
        datasetLabel: "검증 단어장",
        sessionCount: 2,
      }],
      batches: [{
        student_id: assignmentContractIds.studentA,
        session_number: 1,
      }],
    })).toThrow(VocabAssignmentQueuePlanError);
  });
});
