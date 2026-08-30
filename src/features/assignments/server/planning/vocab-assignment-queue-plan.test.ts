import { describe, expect, it } from "vitest";

import { bulkAssignmentSchema } from "@/features/assignments/contracts/bulk-assignment-request";
import {
  assignmentContractIds,
  bulkSubmitContract,
} from "@/test-support/assignment-contract-fixtures";

import {
  buildVocabAssignmentQueueSeriesPayload,
  VocabAssignmentQueuePlanError,
} from "@/features/assignments/server/planning/vocab-assignment-queue-plan";

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
    commonPlan: {
      datasetId: assignmentContractIds.dataset,
      distribution: "split",
      splitBasis: "question_count",
      orderedUnitIds: [assignmentContractIds.day57],
      rangeUnitCounts: [],
      unitAllocationRule: null,
      questionCount: { mode: "manual", value: 4 },
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: 2,
      selectionMode: "source_order",
      planNonce: assignmentContractIds.planNonce,
      recurrenceSessions: [first, second].map((slot) => ({
        availableFrom: slot.availableFrom,
        availableUntil: slot.availableUntil,
      })),
      sessions: [first, second],
    },
  }).commonPlan!;
}

describe("vocab assignment queue plan", () => {
  it("keeps session order and converts recurrence slots to Seoul time", () => {
    const payload = buildVocabAssignmentQueueSeriesPayload({
      commonPlan: commonPlan(),
      previewPlanSignature: assignmentContractIds.previewPlanSignature,
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
      split_basis: "question_count",
      allocation_rule: null,
      resolved_plan_sha256: assignmentContractIds.previewPlanSignature,
      recurrence_slots: [
        { isodow: 1, local_time: "16:00:00", duration_seconds: 86400 },
        { isodow: 3, local_time: "17:30:00", duration_seconds: 86400 },
      ],
      items: [{ session_number: 1 }, { session_number: 2 }],
    });
  });

  it("keeps the versioned weekday rule beside concrete queue items", () => {
    const base = commonPlan();
    const rangePlan = bulkAssignmentSchema.parse({
      ...bulkSubmitContract,
      commonPlan: {
        ...base,
        splitBasis: "range_unit",
        orderedUnitIds: [assignmentContractIds.day57, assignmentContractIds.day60],
        rangeUnitCounts: [1, 1],
        unitAllocationRule: {
          schemaVersion: 1,
          mode: "by_weekday",
          unitsPerSession: 1,
          weekdayUnitsPerSession: {
            1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1,
          },
        },
        questionCount: { mode: "all" },
        sessions: [
          { ...base.sessions[0], unitIds: [assignmentContractIds.day57] },
          { ...base.sessions[1], unitIds: [assignmentContractIds.day60] },
        ],
      },
    }).commonPlan!;
    const payload = buildVocabAssignmentQueueSeriesPayload({
      commonPlan: rangePlan,
      previewPlanSignature: assignmentContractIds.previewPlanSignature,
      rangeLabel: "DAY 57~60",
      previewItems: [{
        studentId: assignmentContractIds.studentA,
        datasetId: assignmentContractIds.dataset,
        datasetLabel: "검증 단어장",
        sessionCount: 2,
      }],
      batches: [1, 2].map((sessionNumber) => ({
        student_id: assignmentContractIds.studentA,
        session_number: sessionNumber,
      })),
    });

    expect(payload[0]).toMatchObject({
      split_basis: "range_unit",
      allocation_rule: {
        schema_version: 1,
        mode: "by_weekday",
        units_per_session: 1,
        base_session_unit_counts: [1, 1],
        ordered_unit_ids: [
          assignmentContractIds.day57,
          assignmentContractIds.day60,
        ],
        overflow_policy: "leave",
        extra_date_policy: "unconfirmed",
        weekday_units_per_session: [
          { isodow: 1, unit_count: 1 },
          { isodow: 2, unit_count: 1 },
          { isodow: 3, unit_count: 1 },
          { isodow: 4, unit_count: 1 },
          { isodow: 5, unit_count: 1 },
          { isodow: 6, unit_count: 1 },
          { isodow: 7, unit_count: 1 },
        ],
      },
    });
  });

  it("rejects a queue whose batch count differs from Preview", () => {
    expect(() => buildVocabAssignmentQueueSeriesPayload({
      commonPlan: commonPlan(),
      previewPlanSignature: assignmentContractIds.previewPlanSignature,
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
