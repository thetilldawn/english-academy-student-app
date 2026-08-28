import {
  buildDirectReviewAssignmentRequest,
  buildDirectReviewPreviewRequest,
  buildDirectReviewSummariesRequest,
  directReviewPreviewFingerprint,
  directReviewSubmissionFingerprint,
} from "../api/request-adapters";
import {
  parseAssignmentCreationResponse,
  parseDirectReviewDatasetSummariesResponse,
  parseDirectReviewPreviewResponse,
  type AssignmentCreationResponse,
  type DirectReviewDatasetSummariesResponse,
  type DirectReviewPreviewResponse,
} from "../api/response-adapters";
import type { DirectReviewAssignmentDraft } from "../domain/model";
import {
  validateDirectReviewAssignmentSubmission,
} from "../domain/validation";
import type { AssignmentTransport } from "../transport/assignment-transport";
import type { AssignmentOperationError } from "./assignment-operation-error";
import { executeAssignmentRequest } from "./execute-assignment-request";
import type { AssignmentPreviewPreparation } from "./preview-flow";
import type {
  AssignmentSubmissionPreparationResult,
} from "./submission-flow";

const PREVIEW_FALLBACK = "오답 단어 수를 계산하지 못했습니다.";
const SUBMISSION_FALLBACK = "오답 시험을 배정하지 못했습니다.";

function responseCode(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("code" in data)) return null;
  return typeof data.code === "string" ? data.code : null;
}

export async function loadDirectReviewSummaries({
  fallback,
  signal,
  studentId,
  transport,
}: {
  fallback: string;
  signal?: AbortSignal;
  studentId: string;
  transport: AssignmentTransport;
}) {
  const request = buildDirectReviewSummariesRequest(studentId);
  return await executeAssignmentRequest<DirectReviewDatasetSummariesResponse>({
    fallback,
    parse: parseDirectReviewDatasetSummariesResponse,
    request: {
      method: request.method,
      signal,
      url: request.endpoint,
    },
    transport,
  });
}

export function resolveDirectReviewSubmissionIssues(
  input: {
    draft: DirectReviewAssignmentDraft;
    wrongEligible: number;
  },
  nowMilliseconds: number,
) {
  return validateDirectReviewAssignmentSubmission(
    input.draft,
    input.wrongEligible,
    nowMilliseconds,
  );
}

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
    recoveryForResponse: (response) =>
      response.status === 409 ? "refresh_summary_and_preview" : undefined,
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
  const issues = resolveDirectReviewSubmissionIssues(input, nowMilliseconds);
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
      recoveryForResponse: (response) => {
        if (response.status !== 409) return undefined;
        return responseCode(response.data) === "idempotency_key_reused"
          ? "none"
          : "refresh_summary_and_preview";
      },
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
