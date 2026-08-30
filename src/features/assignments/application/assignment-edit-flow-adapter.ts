import { hydrateSingleAssignmentDraftFromEditResponse } from "../api/edit-draft-adapter";
import {
  assignmentCapacityFingerprint,
  buildAssignmentCapacityRequest,
  buildAssignmentEditDraftRequest,
  buildSingleAssignmentRequest,
  replacementDraftFingerprint,
  replacementSubmissionFingerprint,
} from "../api/request-adapters";
import {
  parseAssignmentCapacityResponse,
  parseAssignmentCreationResponse,
  parseAssignmentEditDraftResponse,
  parseAssignmentReplacementResponse,
  type AssignmentCapacityResponse,
} from "../api/response-adapters";
import type { SingleAssignmentResult } from "../contracts/single-assignment-editor-contract";
import { assignmentRequestFingerprint } from "../domain/fingerprint";
import type {
  ResolvedSingleAssignment,
  SingleAssignmentDraft,
} from "../domain/model";
import {
  deriveSingleAssignmentSubmitBlocker,
  type SingleAssignmentSubmitBlocker,
} from "../domain/submit-blocker";
import {
  validateSingleAssignmentSubmission,
  type AssignmentDraftIssue,
} from "../domain/validation";
import type { AssignmentTransport } from "../transport/assignment-transport";
import type { AssignmentOperationError } from "./assignment-operation-error";
import { executeAssignmentRequest } from "./execute-assignment-request";
import type { AssignmentPreviewPreparation } from "./preview-flow";
import type {
  AssignmentSubmissionPreparationResult,
} from "./submission-flow";

export type SingleAssignmentPreviewPreparation = {
  minimumAllowedQuestionCount: number;
  preparation: AssignmentPreviewPreparation<AssignmentCapacityResponse>;
};

export type SingleAssignmentPreviewInput = Pick<
  SingleAssignmentDraft,
  "operation" | "range" | "review" | "studentId"
> & {
  directionRatio: SingleAssignmentDraft["exam"]["directionRatio"];
};

function capacityProjectionDraft({
  directionRatio,
  operation,
  range,
  review,
  studentId,
}: Pick<SingleAssignmentDraft, "operation" | "range" | "review" | "studentId"> & {
  directionRatio: SingleAssignmentDraft["exam"]["directionRatio"];
}): SingleAssignmentDraft {
  return {
    availability: { mode: "immediate" },
    deadline: { mode: "none" },
    exam: {
      directionRatio,
      passingScore: 0,
      questionOrderMode: "random",
      timing: { mode: "total", totalSeconds: 30 },
    },
    kind: "single",
    operation,
    questionCount: { mode: "automatic", value: 4 },
    range,
    review,
    studentId,
    title: { mode: "automatic" },
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

function responseCode(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("code" in data)) return null;
  return typeof data.code === "string" ? data.code : null;
}

export async function loadSingleAssignmentEditDraft({
  assignmentId,
  fallback,
  signal,
  studentId,
  transport,
}: {
  assignmentId: string;
  fallback: string;
  signal?: AbortSignal;
  studentId: string;
  transport: AssignmentTransport;
}) {
  const request = buildAssignmentEditDraftRequest(assignmentId, studentId);
  return await executeAssignmentRequest<SingleAssignmentDraft>({
    fallback,
    parse: (data) => {
      const parsed = parseAssignmentEditDraftResponse(data);
      if (
        parsed.assignmentId !== assignmentId ||
        parsed.studentId !== studentId
      ) {
        throw new Error("수정 대상이 응답과 다릅니다.");
      }
      return hydrateSingleAssignmentDraftFromEditResponse(parsed);
    },
    request: {
      method: request.method,
      signal,
      url: request.endpoint,
    },
    transport,
  });
}

export function prepareSingleAssignmentPreview(
  input: SingleAssignmentPreviewInput,
  fallback: string,
): SingleAssignmentPreviewPreparation | null {
  try {
    const projectedDraft = capacityProjectionDraft(input);
    const request = buildAssignmentCapacityRequest(projectedDraft);
    return {
      minimumAllowedQuestionCount:
        input.operation.mode === "replace" &&
        input.operation.sourcePurpose === "review"
          ? 1
          : 4,
      preparation: {
        fallback,
        fingerprint: assignmentCapacityFingerprint(projectedDraft),
        parse: parseAssignmentCapacityResponse,
        recoveryForResponse: (response) => {
          if (response.status !== 409) return undefined;
          return input.operation.mode === "replace"
            ? "reload_source"
            : "refresh_preview";
        },
        request: {
          body: request.body,
          method: request.method,
          url: request.endpoint,
        },
      },
    };
  } catch {
    return null;
  }
}

export function singleCapacityIdentity(
  draft: SingleAssignmentDraft,
): string | null {
  return prepareSingleAssignmentPreview(
    {
      directionRatio: draft.exam.directionRatio,
      operation: draft.operation,
      range: draft.range,
      review: draft.review,
      studentId: draft.studentId,
    },
    "",
  )?.preparation.fingerprint ?? null;
}

export function singleReplacementIsDirty(
  currentDraft: SingleAssignmentDraft,
  currentResolved: ResolvedSingleAssignment,
  baselineDraft: SingleAssignmentDraft,
  baselineResolved: ResolvedSingleAssignment,
): boolean {
  try {
    return replacementDraftFingerprint(currentDraft, currentResolved) !==
      replacementDraftFingerprint(baselineDraft, baselineResolved);
  } catch {
    return assignmentRequestFingerprint(currentDraft) !==
      assignmentRequestFingerprint(baselineDraft);
  }
}

export function singleSubmissionProgressIdentity(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
): string | null {
  try {
    return draft.operation.mode === "replace"
      ? replacementDraftFingerprint(draft, resolved)
      : assignmentRequestFingerprint({ draft, resolved });
  } catch {
    return null;
  }
}

export function resolveSingleAssignmentIssues(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
  nowMilliseconds: number,
): AssignmentDraftIssue[] {
  return validateSingleAssignmentSubmission(draft, resolved, nowMilliseconds);
}

export function resolveSingleAssignmentSubmitBlocker(input: Parameters<
  typeof deriveSingleAssignmentSubmitBlocker
>[0]): SingleAssignmentSubmitBlocker | null {
  return deriveSingleAssignmentSubmitBlocker(input);
}

export function prepareSingleAssignmentSubmission(
  input: {
    draft: SingleAssignmentDraft;
    fallback: string;
    resolved: ResolvedSingleAssignment;
  },
  nowMilliseconds: number,
): AssignmentSubmissionPreparationResult<SingleAssignmentResult> {
  const issues = resolveSingleAssignmentIssues(
    input.draft,
    input.resolved,
    nowMilliseconds,
  );
  if (issues.length > 0) return { error: invalidRequest(issues[0]), ok: false };

  let fingerprint: string;
  if (input.draft.operation.mode === "replace") {
    fingerprint = replacementSubmissionFingerprint(
      input.draft,
      input.resolved,
      nowMilliseconds,
    );
  } else {
    fingerprint = assignmentRequestFingerprint(
      buildSingleAssignmentRequest(input.draft, input.resolved, {
        nowMilliseconds,
      }).body,
    );
  }

  return {
    ok: true,
    value: {
      fallback: input.fallback,
      fingerprint,
      parse: (data) =>
        input.draft.operation.mode === "replace"
          ? parseAssignmentReplacementResponse(data)
          : parseAssignmentCreationResponse(data),
      recoveryForResponse: (response) => {
        if (response.status !== 409) return undefined;
        if (input.draft.operation.mode !== "replace") {
          return "refresh_preview";
        }
        return responseCode(response.data) === "idempotency_key_reused"
          ? "none"
          : "reload_source";
      },
      request: (idempotencyKey) => {
        const request = buildSingleAssignmentRequest(
          input.draft,
          input.resolved,
          {
            idempotencyKey:
              input.draft.operation.mode === "replace"
                ? idempotencyKey
                : undefined,
            nowMilliseconds,
          },
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
