import { koreanDateTimeLocalToIso } from "@/lib/deadline";
import { assignmentReplacementFingerprintPayload } from "@/lib/admin/assignment-replacement-fingerprint";
import type {
  AssignmentCapacityInput,
  AssignmentReplacementInput,
} from "@/lib/admin/assignment-replacement-request";
import type {
  BulkAssignmentInput,
  BulkAssignmentPreviewInput,
} from "@/lib/admin/bulk-assignment-request";
import type {
  DirectReviewAssignmentInput,
  DirectReviewPreviewInput,
} from "@/lib/admin/direct-review-assignment-request";
import type { MixedAssignmentInput } from "@/lib/admin/mixed-assignment-request";
import type { AssignmentInput } from "@/lib/admin/regular-assignment-request";

import { assignmentRequestFingerprint } from "../domain/fingerprint";
import type {
  AssignmentDirectionRatio,
  AssignmentDeadline,
  BulkSeriesAssignmentDraft,
  DirectReviewAssignmentDraft,
  ExamSettings,
  LegacyReviewRecoveryDraft,
  ReviewLevel,
  ReviewPolicy,
  ResolvedSingleAssignment,
  SingleAssignmentDraft,
} from "../domain/model";
import {
  assertValidAssignmentDraft,
  assertValidBulkAssignmentSubmission,
  assertValidBulkPreviewProjection,
  assertValidSingleAssignmentSubmission,
  assertValidSingleCapacityProjection,
} from "../domain/validation";

const PER_QUESTION_TOTAL_TIME_COMPATIBILITY_SECONDS = 10800;

export type RegularAssignmentRequest = {
  endpoint: "/api/admin/assignments";
  method: "POST";
  body: AssignmentInput;
};

export type MixedAssignmentRequest = {
  endpoint: "/api/admin/mixed-assignments";
  method: "POST";
  body: MixedAssignmentInput;
};

export type DirectReviewAssignmentRequest = {
  endpoint: "/api/admin/exact-review-assignments";
  method: "POST";
  body: DirectReviewAssignmentInput;
};

export type DirectReviewPreviewRequest = {
  endpoint: "/api/admin/exact-review-assignments/preview";
  method: "POST";
  body: DirectReviewPreviewInput;
};

export type DirectReviewSummariesRequest = {
  endpoint: `/api/admin/students/${string}/direct-review-summaries`;
  method: "GET";
};

export type AssignmentCapacityRequest = {
  endpoint:
    | "/api/admin/assignment-capacity"
    | `/api/admin/assignments/${string}/students/${string}`;
  method: "POST";
  body: AssignmentCapacityInput;
};

export type AssignmentReplacementRequest = {
  endpoint: `/api/admin/assignments/${string}/students/${string}`;
  method: "PUT";
  body: AssignmentReplacementInput;
};

export type AssignmentEditDraftRequest = {
  endpoint: `/api/admin/assignments/${string}/students/${string}`;
  method: "GET";
};

export type BulkAssignmentPreviewRequest = {
  endpoint: "/api/admin/bulk-assignments/preview";
  method: "POST";
  body: BulkAssignmentPreviewInput;
};

export type BulkAssignmentRequest = {
  endpoint: "/api/admin/bulk-assignments";
  method: "POST";
  body: BulkAssignmentInput;
};

export type LegacyReviewCancelRequest = {
  endpoint: `/api/admin/students/${string}/review-assignment-drafts/${string}`;
  method: "DELETE";
};

export type AssignmentHttpRequest =
  | RegularAssignmentRequest
  | MixedAssignmentRequest
  | DirectReviewAssignmentRequest
  | DirectReviewPreviewRequest
  | DirectReviewSummariesRequest
  | AssignmentEditDraftRequest
  | AssignmentCapacityRequest
  | AssignmentReplacementRequest
  | BulkAssignmentPreviewRequest
  | BulkAssignmentRequest
  | LegacyReviewCancelRequest;

export function buildAssignmentEditDraftRequest(
  assignmentId: string,
  studentId: string,
): AssignmentEditDraftRequest {
  return {
    endpoint: `/api/admin/assignments/${assignmentId}/students/${studentId}`,
    method: "GET",
  };
}

export function buildDirectReviewSummariesRequest(
  studentId: string,
): DirectReviewSummariesRequest {
  return {
    endpoint: `/api/admin/students/${studentId}/direct-review-summaries`,
    method: "GET",
  };
}

function deadlineToIso(deadline: AssignmentDeadline): string | null {
  if (deadline.mode === "none") return null;
  const value = koreanDateTimeLocalToIso(deadline.koreanLocalDateTime);
  if (!value) throw new Error("검증되지 않은 한국시간 마감입니다.");
  return value;
}

function availabilityToIso(
  availability: SingleAssignmentDraft["availability"],
): string | null {
  if (availability.mode === "immediate") return null;
  const value = koreanDateTimeLocalToIso(availability.koreanLocalDateTime);
  if (!value) throw new Error("검증되지 않은 한국시간 공개 시각입니다.");
  return value;
}

export function buildDirectReviewAssignmentRequest(
  draft: DirectReviewAssignmentDraft,
  idempotencyKey: string,
): DirectReviewAssignmentRequest {
  return {
    endpoint: "/api/admin/exact-review-assignments",
    method: "POST",
    body: {
      idempotencyKey,
      studentId: draft.studentId,
      datasetId: draft.datasetId,
      reviewLevels: [...draft.reviewLevels],
      totalQuestionCount: draft.questionCount,
      title: draft.title,
      ...examSettingsToApi(draft.exam),
      availableUntil: deadlineToIso(draft.deadline),
    },
  };
}

export function directReviewSubmissionFingerprint(
  draft: DirectReviewAssignmentDraft,
): string {
  const payload = buildDirectReviewAssignmentRequest(
    draft,
    "fingerprint-only",
  ).body;
  return assignmentRequestFingerprint({
    ...payload,
    idempotencyKey: undefined,
    reviewLevels: [...payload.reviewLevels].toSorted(),
  });
}

export function buildDirectReviewPreviewRequest(
  input: {
    studentId: string;
    datasetId: string;
    reviewLevels: readonly ReviewLevel[];
    directionRatio: AssignmentDirectionRatio;
  },
): DirectReviewPreviewRequest {
  return {
    endpoint: "/api/admin/exact-review-assignments/preview",
    method: "POST",
    body: {
      studentId: input.studentId,
      datasetId: input.datasetId,
      reviewLevels: [...input.reviewLevels],
      englishToKoreanRatio: input.directionRatio,
    },
  };
}

export function directReviewPreviewFingerprint(
  input: Parameters<typeof buildDirectReviewPreviewRequest>[0],
): string {
  const request = buildDirectReviewPreviewRequest(input);
  return assignmentRequestFingerprint({
    ...request.body,
    reviewLevels: [...request.body.reviewLevels].toSorted(),
  });
}

function examSettingsToApi(exam: ExamSettings) {
  const retry = {
    retryEnabled: exam.retryEnabled !== false,
    retryPassingScore: exam.retryEnabled === false
      ? null
      : exam.retryPassingScore ?? exam.passingScore,
  };
  if (exam.timeLimitEnabled === false) {
    return {
      englishToKoreanRatio: exam.directionRatio,
      timeLimitSeconds: PER_QUESTION_TOTAL_TIME_COMPATIBILITY_SECONDS,
      timingMode: "none" as const,
      questionTimeLimitSeconds: null,
      passingScore: exam.passingScore,
      questionOrderMode: exam.questionOrderMode,
      ...retry,
    };
  }
  if (exam.timing.mode === "total") {
    return {
      englishToKoreanRatio: exam.directionRatio,
      timeLimitSeconds: exam.timing.totalSeconds,
      timingMode: "total" as const,
      questionTimeLimitSeconds: null,
      passingScore: exam.passingScore,
      questionOrderMode: exam.questionOrderMode,
      ...retry,
    };
  }
  return {
    englishToKoreanRatio: exam.directionRatio,
    timeLimitSeconds: PER_QUESTION_TOTAL_TIME_COMPATIBILITY_SECONDS,
    timingMode: "per_question" as const,
    questionTimeLimitSeconds: exam.timing.perQuestionSeconds,
    passingScore: exam.passingScore,
    questionOrderMode: exam.questionOrderMode,
    ...retry,
  };
}

function reviewPolicyToCapacityApi(review: ReviewPolicy) {
  if (review.mode === "none") {
    return {
      includePendingReview: false,
      reviewLevels: [...review.levels],
      reviewScope: review.scope,
    };
  }
  return {
    includePendingReview: true,
    reviewLevels: [...review.levels],
    reviewScope: review.scope,
  };
}

function reviewPolicyToReplacementApi(review: ReviewPolicy) {
  return {
    includePendingReview: review.mode === "pending",
    reviewScope: review.scope,
    reviewLevels: [...review.levels],
  };
}

function singleCapacityBody(draft: SingleAssignmentDraft) {
  return {
    studentId: draft.studentId,
    datasetId: draft.range.datasetId,
    primaryUnitIds: [...draft.range.orderedUnitIds],
    ...reviewPolicyToCapacityApi(draft.review),
    englishToKoreanRatio: draft.exam.directionRatio,
  };
}

export function buildAssignmentCapacityRequest(
  draft: SingleAssignmentDraft,
): AssignmentCapacityRequest {
  assertValidSingleCapacityProjection(draft);
  if (draft.operation.mode === "create") {
    return {
      endpoint: "/api/admin/assignment-capacity",
      method: "POST",
      body: singleCapacityBody(draft),
    };
  }
  return {
    endpoint: `/api/admin/assignments/${draft.operation.assignmentId}/students/${draft.operation.targetStudentId}`,
    method: "POST",
    body: singleCapacityBody(draft),
  };
}

export function assignmentCapacityFingerprint(
  draft: SingleAssignmentDraft,
): string {
  return assignmentRequestFingerprint(
    buildAssignmentCapacityRequest(draft).body,
  );
}

function replacementBodyWithoutIdempotency(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
): Omit<AssignmentReplacementInput, "idempotencyKey"> {
  return {
    title: resolved.submissionTitle.trim(),
    datasetId: draft.range.datasetId,
    primaryUnitIds: [...draft.range.orderedUnitIds],
    ...reviewPolicyToReplacementApi(draft.review),
    questionCount: resolved.questionCount,
    ...examSettingsToApi(draft.exam),
    availableFrom: availabilityToIso(draft.availability),
    availableUntil: deadlineToIso(draft.deadline),
  };
}

export function buildSingleAssignmentRequest(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
  options: { nowMilliseconds: number; idempotencyKey?: string },
):
  | RegularAssignmentRequest
  | MixedAssignmentRequest
  | AssignmentReplacementRequest {
  assertValidSingleAssignmentSubmission(
    draft,
    resolved,
    options.nowMilliseconds,
  );

  if (draft.operation.mode === "replace") {
    if (!options.idempotencyKey) {
      throw new Error("수정 요청에는 멱등키가 필요합니다.");
    }
    return {
      endpoint: `/api/admin/assignments/${draft.operation.assignmentId}/students/${draft.operation.targetStudentId}`,
      method: "PUT",
      body: {
        idempotencyKey: options.idempotencyKey,
        ...replacementBodyWithoutIdempotency(draft, resolved),
      },
    };
  }

  const exam = examSettingsToApi(draft.exam);
  const availableUntil = deadlineToIso(draft.deadline);

  if (draft.review.mode === "pending") {
    return {
      endpoint: "/api/admin/mixed-assignments",
      method: "POST",
      body: {
        studentId: draft.studentId,
        datasetId: draft.range.datasetId,
        primaryUnitIds: [...draft.range.orderedUnitIds],
        reviewLevels: [...draft.review.levels],
        reviewScope: draft.review.scope,
        totalQuestionCount: resolved.questionCount,
        title: resolved.submissionTitle,
        ...exam,
        availableUntil,
      },
    };
  }

  return {
    endpoint: "/api/admin/assignments",
    method: "POST",
    body: {
      title: resolved.submissionTitle,
      datasetId: draft.range.datasetId,
      unitIds: [...draft.range.orderedUnitIds],
      questionCount: resolved.questionCount,
      ...exam,
      availableUntil,
      studentIds: [draft.studentId],
    },
  };
}

function bulkSelectionBody(draft: BulkSeriesAssignmentDraft) {
  const firstAvailableFrom = koreanDateTimeLocalToIso(
    `${draft.firstAvailableDateKorean}T00:00`,
  );
  if (!firstAvailableFrom) {
    throw new Error("검증되지 않은 한국시간 시작 시각입니다.");
  }
  const commonPlan = draft.commonPlan
    ? {
        datasetId: draft.commonPlan.datasetId,
        distribution: draft.commonPlan.distribution,
        splitBasis: draft.commonPlan.splitBasis,
        orderedUnitIds: [...draft.commonPlan.orderedUnitIds],
        rangeUnitCounts: [...draft.commonPlan.rangeUnitCounts],
        unitAllocationRule: draft.commonPlan.unitAllocationRule
          ? {
              ...draft.commonPlan.unitAllocationRule,
              weekdayUnitsPerSession: {
                ...draft.commonPlan.unitAllocationRule.weekdayUnitsPerSession,
              },
            }
          : null,
        questionCount: draft.commonPlan.questionCount,
        overflowPolicy: draft.commonPlan.overflowPolicy,
        extraDatePolicy: draft.commonPlan.extraDatePolicy,
        selectedDateCount: draft.commonPlan.selectedDateCount,
        selectionMode: draft.commonPlan.selectionMode,
        planNonce: draft.commonPlan.planNonce,
        recurrenceSessions: draft.commonPlan.recurrenceSessions.map(
          (session) => {
            const availableFrom = koreanDateTimeLocalToIso(
              session.availableLocalDateTime,
            );
            const availableUntil = session.deadlineLocalDateTime
              ? koreanDateTimeLocalToIso(session.deadlineLocalDateTime)
              : null;
            if (!availableFrom ||
              (session.deadlineLocalDateTime && !availableUntil)) {
              throw new Error("검증되지 않은 반복 일정 시각입니다.");
            }
            return { availableFrom, availableUntil };
          },
        ),
        sessions: draft.commonPlan.sessions.map((session) => {
          const availableFrom = koreanDateTimeLocalToIso(
            session.availableLocalDateTime,
          );
          const availableUntil = session.deadlineLocalDateTime
            ? koreanDateTimeLocalToIso(session.deadlineLocalDateTime)
            : null;
          if (!availableFrom ||
            (session.deadlineLocalDateTime && !availableUntil)) {
            throw new Error("검증되지 않은 공통 배정 시각입니다.");
          }
          return {
            unitIds: [...session.unitIds],
            availableFrom,
            availableUntil,
          };
        }),
        collisionDecisions: draft.commonPlan.collisionDecisions.map(
          (decision) => {
            const movedAvailableFrom = decision.movedAvailableLocalDateTime
              ? koreanDateTimeLocalToIso(
                  decision.movedAvailableLocalDateTime,
                )
              : null;
            const movedAvailableUntil = decision.movedDeadlineLocalDateTime
              ? koreanDateTimeLocalToIso(
                  decision.movedDeadlineLocalDateTime,
                )
              : null;
            return {
              collisionId: decision.collisionId,
              mode: decision.mode,
              movedAvailableFrom,
              movedAvailableUntil,
            };
          },
        ),
      }
    : undefined;
  return {
    studentIds: [...draft.studentIds],
    rangeMode: draft.range.mode,
    unitsPerSession: draft.range.unitsPerSession,
    sessionCount: draft.range.sessionCount,
    firstAvailableFrom,
    dayInterval: draft.dayInterval,
    firstAvailableUntil: deadlineToIso(draft.firstDeadline),
    includePendingReview: draft.review.mode === "pending",
    reviewLevels: [...draft.review.levels],
    englishToKoreanRatio: draft.exam.directionRatio,
    ...(commonPlan ? { commonPlan } : {}),
  };
}

export function buildBulkAssignmentPreviewRequest(
  draft: BulkSeriesAssignmentDraft,
): BulkAssignmentPreviewRequest {
  assertValidBulkPreviewProjection(draft);
  return {
    endpoint: "/api/admin/bulk-assignments/preview",
    method: "POST",
    body: bulkSelectionBody(draft),
  };
}

export function buildBulkAssignmentRequest(
  draft: BulkSeriesAssignmentDraft,
  idempotencyKey: string,
  nowMilliseconds: number,
  previewPlanSignature: string,
): BulkAssignmentRequest {
  assertValidBulkAssignmentSubmission(draft, nowMilliseconds);
  if (!idempotencyKey) throw new Error("일괄 배정에는 멱등키가 필요합니다.");
  if (!/^[0-9a-f]{64}$/.test(previewPlanSignature)) {
    throw new Error("일괄 배정에는 현재 미리보기 계획이 필요합니다.");
  }
  return {
    endpoint: "/api/admin/bulk-assignments",
    method: "POST",
    body: {
      ...bulkSelectionBody(draft),
      idempotencyKey,
      previewPlanSignature,
      ...examSettingsToApi(draft.exam),
    },
  };
}

export function bulkPreviewFingerprint(
  draft: BulkSeriesAssignmentDraft,
): string {
  return assignmentRequestFingerprint(
    buildBulkAssignmentPreviewRequest(draft).body,
  );
}

export function bulkSubmissionFingerprint(
  draft: BulkSeriesAssignmentDraft,
  previewPlanSignature: string,
): string {
  const previewBody = buildBulkAssignmentPreviewRequest(draft).body;
  return assignmentRequestFingerprint({
    ...previewBody,
    studentIds: [...draft.studentIds].toSorted(),
    reviewLevels: [...draft.review.levels].toSorted(),
    previewPlanSignature,
    ...examSettingsToApi(draft.exam),
  });
}

export function replacementSubmissionFingerprint(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
  nowMilliseconds: number,
): string {
  if (draft.operation.mode !== "replace") {
    throw new Error("수정 draft만 fingerprint를 만들 수 있습니다.");
  }
  assertValidSingleAssignmentSubmission(draft, resolved, nowMilliseconds);
  return replacementDraftFingerprint(draft, resolved);
}

export function replacementDraftFingerprint(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
): string {
  if (draft.operation.mode !== "replace") {
    throw new Error("수정 draft만 fingerprint를 만들 수 있습니다.");
  }
  const body = replacementBodyWithoutIdempotency(draft, resolved);
  return assignmentRequestFingerprint(
    assignmentReplacementFingerprintPayload(
      draft.operation.assignmentId,
      draft.operation.targetStudentId,
      body,
    ),
  );
}

export function buildLegacyReviewCancelRequest(
  draft: LegacyReviewRecoveryDraft,
): LegacyReviewCancelRequest {
  assertValidAssignmentDraft(draft);
  return {
    endpoint: `/api/admin/students/${draft.studentId}/review-assignment-drafts/${draft.reviewDraftId}`,
    method: "DELETE",
  };
}
