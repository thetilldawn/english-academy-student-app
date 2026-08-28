import {
  buildBulkAssignmentPreviewRequest,
  buildBulkAssignmentRequest,
  bulkPreviewFingerprint,
  bulkSubmissionFingerprint,
} from "../api/request-adapters";
import {
  parseBulkAssignmentCreationResponse,
  parseBulkAssignmentPreviewResponse,
  type BulkAssignmentCreationResponse,
  type BulkAssignmentPreviewResponse,
} from "../api/response-adapters";
import type { BulkSeriesAssignmentDraft } from "../domain/model";
import {
  validateBulkAssignmentSubmission,
  validateBulkPreviewProjection,
  type AssignmentDraftIssue,
} from "../domain/validation";
import type { AssignmentOperationError } from "./assignment-operation-error";
import type { AssignmentPreviewPreparation } from "./preview-flow";
import type {
  AssignmentSubmissionPreparationResult,
} from "./submission-flow";

const DEFAULT_PREVIEW_FALLBACK = "학생별 범위를 계산하지 못했습니다.";
const DEFAULT_SUBMISSION_FALLBACK = "일괄 배정을 저장하지 못했습니다.";

export type BulkAssignmentFlowPolicy = {
  commonPlanRequired?: boolean;
  commonPlanRequiredMessage?: string;
};

function missingCommonPlanIssue(
  draft: BulkSeriesAssignmentDraft,
  policy: BulkAssignmentFlowPolicy,
): AssignmentDraftIssue | null {
  if (!policy.commonPlanRequired || draft.commonPlan) return null;
  return {
    code: "required",
    path: "commonPlan",
    message:
      policy.commonPlanRequiredMessage ??
      "단어장, 범위, 날짜를 먼저 정해 주세요.",
  };
}

function invalidRequest(issue: AssignmentDraftIssue): AssignmentOperationError {
  return {
    fieldPath: issue.path,
    kind: "invalid_request",
    message: issue.message,
    recovery: "none",
    retryable: false,
  };
}

function invalidPreview(message: string): AssignmentOperationError {
  return {
    fieldPath: "preview",
    kind: "invalid_request",
    message,
    recovery: "refresh_preview",
    retryable: true,
  };
}

export function resolveBulkPreviewIssues(
  draft: BulkSeriesAssignmentDraft,
  policy: BulkAssignmentFlowPolicy = {},
): AssignmentDraftIssue[] {
  const missing = missingCommonPlanIssue(draft, policy);
  return missing ? [missing] : validateBulkPreviewProjection(draft);
}

export function resolveBulkSubmissionIssues(
  draft: BulkSeriesAssignmentDraft,
  nowMilliseconds: number,
  policy: BulkAssignmentFlowPolicy = {},
): AssignmentDraftIssue[] {
  const missing = missingCommonPlanIssue(draft, policy);
  return missing
    ? [missing]
    : validateBulkAssignmentSubmission(draft, nowMilliseconds);
}

export function prepareBulkAssignmentPreview(
  draft: BulkSeriesAssignmentDraft,
  fallback = DEFAULT_PREVIEW_FALLBACK,
): AssignmentPreviewPreparation<BulkAssignmentPreviewResponse> | null {
  if (validateBulkPreviewProjection(draft).length > 0) return null;
  const request = buildBulkAssignmentPreviewRequest(draft);
  return {
    fallback,
    fingerprint: bulkPreviewFingerprint(draft),
    parse: parseBulkAssignmentPreviewResponse,
    recoveryForResponse: (response) =>
      response.status === 409 ? "refresh_preview" : undefined,
    request: {
      body: request.body,
      method: request.method,
      url: request.endpoint,
    },
  };
}

export function bulkPreviewIdentity(
  draft: BulkSeriesAssignmentDraft,
): string | null {
  try {
    return bulkPreviewFingerprint(draft);
  } catch {
    return null;
  }
}

export function bulkPreviewAllowsSubmission(
  draft: BulkSeriesAssignmentDraft,
  preview: BulkAssignmentPreviewResponse,
): boolean {
  return (
    preview.blockedCount === 0 &&
    preview.items.every((item) => !item.requiresExtraDateDecision) &&
    (draft.commonPlan
      ? preview.assignableCount > 0 &&
        preview.assignmentCount > 0 &&
        preview.assignmentCount === preview.items.reduce(
          (count, item) => count + item.sessions.length,
          0,
        )
      : preview.assignableCount === draft.studentIds.length &&
        preview.assignmentCount ===
          draft.studentIds.length * draft.range.sessionCount)
  );
}

export function bulkSubmissionIdentity(
  draft: BulkSeriesAssignmentDraft,
  preview: BulkAssignmentPreviewResponse,
): string | null {
  try {
    return bulkSubmissionFingerprint(draft, preview.planSignature);
  } catch {
    return null;
  }
}

export function prepareBulkAssignmentSubmission(
  input: {
    draft: BulkSeriesAssignmentDraft;
    preview: BulkAssignmentPreviewResponse;
    previewFingerprint: string;
    previewFallback?: string;
    submissionFallback?: string;
  },
  nowMilliseconds: number,
): AssignmentSubmissionPreparationResult<BulkAssignmentCreationResponse> {
  const submissionFallback =
    input.submissionFallback ?? DEFAULT_SUBMISSION_FALLBACK;
  const previewFallback = input.previewFallback ?? DEFAULT_PREVIEW_FALLBACK;
  const issues = validateBulkAssignmentSubmission(
    input.draft,
    nowMilliseconds,
  );
  if (issues.length > 0) return { error: invalidRequest(issues[0]), ok: false };

  const currentPreviewFingerprint = bulkPreviewIdentity(input.draft);
  if (
    !currentPreviewFingerprint ||
    currentPreviewFingerprint !== input.previewFingerprint ||
    !bulkPreviewAllowsSubmission(input.draft, input.preview)
  ) {
    return { error: invalidPreview(previewFallback), ok: false };
  }

  const fingerprint = bulkSubmissionFingerprint(
    input.draft,
    input.preview.planSignature,
  );
  return {
    ok: true,
    value: {
      fallback: submissionFallback,
      fingerprint,
      parse: (data) => {
        const parsed = parseBulkAssignmentCreationResponse(data);
        if (parsed.assignments.length !== input.preview.assignmentCount) {
          throw new Error("배정 결과 수가 미리보기와 다릅니다.");
        }
        return parsed;
      },
      recoveryForResponse: (response) =>
        response.status === 409 ? "refresh_preview" : undefined,
      request: (idempotencyKey) => {
        const request = buildBulkAssignmentRequest(
          input.draft,
          idempotencyKey,
          nowMilliseconds,
          input.preview.planSignature,
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
