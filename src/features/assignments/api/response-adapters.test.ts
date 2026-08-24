import { describe, expect, expectTypeOf, it } from "vitest";

import type { AssignmentEditDraft } from "@/lib/admin/assignment-edit";
import type { AssignmentReplacementResult } from "@/lib/admin/assignment-edit";
import type {
  BulkAssignmentPreview,
  BulkAssignmentResult,
} from "@/lib/services/bulk-assignment-service";
import type { AssignmentCapacity } from "@/lib/services/mixed-assignment-service";
import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import {
  parseAssignmentCapacityResponse,
  parseAssignmentCreationResponse,
  parseAssignmentEditDraftResponse,
  parseAssignmentReplacementResponse,
  parseBulkAssignmentCreationResponse,
  parseBulkAssignmentPreviewResponse,
  parseLegacyReviewCancelResponse,
} from "./response-adapters";
import type {
  AssignmentCapacityResponse,
  AssignmentEditDraftResponse,
  AssignmentReplacementResponse,
  BulkAssignmentCreationResponse,
  BulkAssignmentPreviewResponse,
} from "./response-adapters";

const capacity = {
  eligibleBeforeActiveAssignment: 20,
  activeAssignmentExcluded: 1,
  questionPlanExcluded: 2,
  unitEligible: 17,
  wrongEligible: 3,
  wrongLevel1Eligible: 2,
  wrongLevel2Eligible: 1,
  overlap: 1,
  alreadyAssigned: 1,
  maximumQuestionCount: 19,
  recommendedQuestionCount: 19,
  minimumQuestionCount: 3,
};

describe("assignment response adapters", () => {
  it("stays type-compatible with current service response contracts", () => {
    expectTypeOf<AssignmentCapacityResponse>().toEqualTypeOf<AssignmentCapacity>();
    expectTypeOf<AssignmentEditDraftResponse>().toEqualTypeOf<AssignmentEditDraft>();
    expectTypeOf<AssignmentReplacementResponse>().toEqualTypeOf<AssignmentReplacementResult>();
    expectTypeOf<BulkAssignmentPreviewResponse>().toEqualTypeOf<BulkAssignmentPreview>();
    expectTypeOf<BulkAssignmentCreationResponse["assignments"]>().toEqualTypeOf<
      BulkAssignmentResult[]
    >();
  });

  it("capacity와 단일 생성 성공 응답을 strict하게 검증한다", () => {
    expect(parseAssignmentCapacityResponse(capacity)).toStrictEqual(capacity);
    expect(
      parseAssignmentCreationResponse({
        assignmentId: assignmentContractIds.day57,
      }),
    ).toStrictEqual({ assignmentId: assignmentContractIds.day57 });
    expect(() =>
      parseAssignmentCapacityResponse({
        ...capacity,
        maximumQuestionCount: -1,
      }),
    ).toThrow();
    expect(() => parseAssignmentCreationResponse({})).toThrow();
  });

  it("수정 성공 상태와 UUID를 검증한다", () => {
    const response = {
      status: "replaced",
      sourceAssignmentId: assignmentContractIds.day57,
      replacementAssignmentId: assignmentContractIds.day58,
      studentId: assignmentContractIds.studentA,
      replacementPurpose: "mixed",
      idempotent: false,
    } as const;
    expect(parseAssignmentReplacementResponse(response)).toStrictEqual(
      response,
    );
    expect(() =>
      parseAssignmentReplacementResponse({ ...response, status: "updated" }),
    ).toThrow();
  });

  it("수정 GET 응답의 source purpose, timing, and locked inputs를 검증한다", () => {
    const response = {
      assignmentId: assignmentContractIds.day57,
      studentId: assignmentContractIds.studentA,
      studentName: "검증 학생",
      purpose: "review",
      title: "기존 오답 재시험",
      datasetId: assignmentContractIds.dataset,
      primaryUnitIds: [assignmentContractIds.day60],
      questionCount: 1,
      englishToKoreanRatio: 0,
      timeLimitSeconds: 10800,
      timingMode: "per_question",
      questionTimeLimitSeconds: 20,
      passingScore: 80,
      retryEnabled: true,
      retryPassingScore: 80,
      questionOrderMode: "fixed",
      availableUntil: "2026-08-18T12:00:00.000Z",
      includePendingReview: true,
      reviewLevels: [2],
    } as const;

    expect(parseAssignmentEditDraftResponse(response)).toStrictEqual(
      response,
    );
    expect(() =>
      parseAssignmentEditDraftResponse({
        ...response,
        questionTimeLimitSeconds: null,
      }),
    ).toThrow();
    expect(() =>
      parseAssignmentEditDraftResponse({
        ...response,
        primaryUnitIds: [
          assignmentContractIds.day60,
          assignmentContractIds.day60,
        ],
      }),
    ).toThrow();
  });

  it("일괄 preview의 학생·회차·일정 구조를 검증한다", () => {
    const response = {
      items: [
        {
          studentId: assignmentContractIds.studentA,
          studentName: "검증 학생",
          available: true,
          availableQuestionCount: 40,
          datasetId: assignmentContractIds.dataset,
          datasetLabel: "검증 단어장",
          sessions: [
            {
              sessionNumber: 1,
              sourceSessionNumber: 1,
              cycleIndex: 0,
              available: true,
              unitId: assignmentContractIds.day60,
              unitLabel: "DAY 60",
              unitIds: [assignmentContractIds.day60],
              unitLabels: ["DAY 60"],
              rangeTruncated: false,
              questionCount: 40,
              wrongCount: 3,
              availableFrom: "2026-08-16T15:00:00.000Z",
              availableUntil: "2026-08-17T12:00:00.000Z",
              warnings: [],
              error: null,
            },
          ],
          selectedQuestionCount: 40,
          remainingQuestionCount: 0,
          defaultSessionCount: 1,
          scheduledQuestionCount: 40,
          requiresExtraDateDecision: false,
          error: null,
        },
      ],
      assignableCount: 1,
      blockedCount: 0,
      assignmentCount: 1,
      planSignature: assignmentContractIds.previewPlanSignature,
      rangeLabel: "DAY 60",
      commonPlanSummary: {
        representativeStudentId: assignmentContractIds.studentA,
        normalStudentIds: [assignmentContractIds.studentA],
        exceptionStudentIds: [],
        availableQuestionCount: 40,
        selectedQuestionCount: 40,
        remainingQuestionCount: 0,
        defaultSessionCount: 1,
        scheduledQuestionCount: 40,
        requiresExtraDateDecision: false,
        sessions: [{
          sessionNumber: 1,
          availableFrom: "2026-08-16T15:00:00.000Z",
          availableUntil: "2026-08-17T12:00:00.000Z",
          questionCount: 40,
          cycleIndex: 0,
          unitLabel: "DAY 60",
        }],
      },
    };
    expect(parseBulkAssignmentPreviewResponse(response)).toStrictEqual(
      response,
    );
    expect(parseBulkAssignmentPreviewResponse({
      ...response,
      items: [{
        ...response.items[0],
        sessions: [{
          ...response.items[0]!.sessions[0]!,
          warnings: [{
            id: "planned-order-warning",
            kind: "planned_series_order",
            existingAssignmentId: null,
            existingAssignmentTitle: "이번 배정의 다른 회차",
            message: "이동한 날짜가 이번 배정의 다른 회차와 겹칩니다.",
            resolved: false,
          }],
        }],
      }],
    }).items[0]?.sessions[0]?.warnings[0]?.kind).toBe(
      "planned_series_order",
    );
    expect(parseBulkAssignmentPreviewResponse({
      ...response,
      blockedCount: 1,
      assignableCount: 0,
      assignmentCount: 0,
      commonPlanSummary: null,
      items: [{
        ...response.items[0],
        available: false,
        error: "직접 입력한 문항 수가 너무 큽니다.",
        errorFieldKey: "questionCount",
        sessions: [],
      }],
    }).items[0]?.errorFieldKey).toBe("questionCount");
    expect(() =>
      parseBulkAssignmentPreviewResponse({
        ...response,
        items: [{ ...response.items[0], studentId: "not-a-uuid" }],
      }),
    ).toThrow();
  });

  it("일괄 생성과 legacy 취소 응답의 허용 상태만 받는다", () => {
    const created = {
      assignments: [
        {
          student_id: assignmentContractIds.studentA,
          assignment_id: assignmentContractIds.day59,
          session_number: 1,
        },
      ],
    };
    expect(parseBulkAssignmentCreationResponse(created)).toStrictEqual({
      assignments: [
        {
          ...created.assignments[0],
          queue_item_id: null,
          queue_series_id: null,
          status: "assigned",
        },
      ],
    });
    expect(
      parseLegacyReviewCancelResponse({
        status: "cancelled",
        queueDisposition: "pending",
      }),
    ).toStrictEqual({
      status: "cancelled",
      queueDisposition: "pending",
    });
    expect(() =>
      parseLegacyReviewCancelResponse({
        status: "cancelled",
        queueDisposition: "reserved",
      }),
    ).toThrow();
  });
});
