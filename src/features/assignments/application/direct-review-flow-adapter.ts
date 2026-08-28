import {
  buildDirectReviewAssignmentRequest,
  buildDirectReviewPreviewRequest,
  directReviewPreviewFingerprint,
  directReviewSubmissionFingerprint,
} from "../api/request-adapters";
import {
  parseAssignmentCreationResponse,
  parseDirectReviewPreviewResponse,
  type AssignmentCreationResponse,
  type DirectReviewPreviewResponse,
} from "../api/response-adapters";
import type { DirectReviewAssignmentDraft } from "../domain/model";
import {
  validateDirectReviewAssignmentSubmission,
} from "../domain/validation";
import type { AssignmentOperationError } from "./assignment-operation-error";
import type { AssignmentPreviewPreparation } from "./preview-flow";
import type {
  AssignmentSubmissionPreparationResult,
} from "./submission-flow";

const PREVIEW_FALLBACK = "오답 단어 수를 계산하지 못했습니다.";
const SUBMISSION_FALLBACK = "오답 시험을 배정하지 못했습니다.";

export function prepareDirectReviewPreview(
  input: {
    datasetId: string;
    directionRatio: DirectReviewAssignmentDraft["exam"]["directionRatio"];
    reviewLevels: DirectReviewAssignmentDraft["reviewLevels"];
    studentId: string;
  },
  signal?: AbortSignal,
): AssignmentPreviewPreparation<DirectReviewPreviewResponse> {
  const request = buildDirectReviewPreviewRequest(input);
  return {
    fallback: PREVIEW_FALLBACK,
    fingerprint: directReviewPreviewFingerprint(input),
    parse: parseDirectReviewPreviewResponse,
    recoveryForStatus: (status) =>
      status === 409 ? "refresh_summary_and_preview" : undefined,
    request: {
      body: request.body,
      method: request.method,
      signal,
      url: request.endpoint,
    },
  };
}

export function prepareDirectReviewSubmission(
  input: {
    draft: DirectReviewAssignmentDraft;
    wrongEligible: number;
  },
  nowMilliseconds: number,
): AssignmentSubmissionPreparationResult<AssignmentCreationResponse> {
  const issues = validateDirectReviewAssignmentSubmission(
    input.draft,
    input.wrongEligible,
    nowMilliseconds,
  );
  if (issues.length > 0) {
    const issue = issues[0];
    const error: AssignmentOperationError = {
      fieldPath: issue.path,
      kind: "invalid_request",
      message: issue.message,
      recovery: "none",
      retryable: false,
    };
    return { error, ok: false };
  }
  return {
    ok: true,
    value: {
      fallback: SUBMISSION_FALLBACK,
      fingerprint: directReviewSubmissionFingerprint(input.draft),
      parse: parseAssignmentCreationResponse,
      recoveryForStatus: (status) =>
        status === 409 ? "refresh_summary_and_preview" : undefined,
      request: (idempotencyKey) => {
        const request = buildDirectReviewAssignmentRequest(
          input.draft,
          idempotencyKey,
        );
        return {
          body: request.body,
          method: request.method,
          url: request.endpoint,
        };
      },
    },
  };
}
