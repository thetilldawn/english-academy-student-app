import { buildMixedMistakePreviewRequest, buildMixedMistakeSaveRequest } from "../api/request-adapters";
import {
  mixedMistakePreviewSchema, mixedMistakeResultSchema,
  type MixedMistakePreview, type MixedMistakeResult,
} from "../contracts/mixed-mistake-assignment";
import { assignmentRequestFingerprint } from "../domain/fingerprint";
import type { SingleAssignmentDraft, ResolvedSingleAssignment } from "../domain/model";
import { validateSingleAssignmentSubmission } from "../domain/validation";
import type { AssignmentPreviewPreparation } from "./preview-flow";
import type { AssignmentSubmissionPreparationResult } from "./submission-flow";

type DraftInput = { draft: SingleAssignmentDraft; resolved: ResolvedSingleAssignment };

export function resolveMixedMistakeSubmissionIssues(input: DraftInput & {
  datasetIds: readonly string[]; unitIds: readonly string[]; unitsReady: boolean;
}, nowMilliseconds: number) {
  const issues = validateSingleAssignmentSubmission(input.draft, input.resolved, nowMilliseconds);
  if (!input.datasetIds.includes(input.draft.range.datasetId)) issues.push({ code: "invalid_id", path: "range.datasetId", message: "혼합 배정에 사용할 단어장을 선택해 주세요." });
  const known = new Set(input.unitIds);
  if (!input.unitsReady || input.draft.range.orderedUnitIds.some(id => !known.has(id))) issues.push({ code: "invalid_id", path: "range.orderedUnitIds", message: "시험 범위를 다시 확인해 주세요." });
  return issues;
}

export function prepareMixedMistakePreview(input: DraftInput): AssignmentPreviewPreparation<MixedMistakePreview> {
  const request = buildMixedMistakePreviewRequest(input.draft, input.resolved);
  return {
    fallback: "범위와 오답을 함께 계산하지 못했습니다.",
    fingerprint: assignmentRequestFingerprint(request.body),
    parse: data => {
      const value = mixedMistakePreviewSchema.parse(data);
      if (value.totalQuestionCount !== request.body.totalQuestionCount) throw new Error("문항 수가 다른 미리보기입니다.");
      return value;
    },
    recoveryForResponse: response => response.status === 409 ? "refresh_preview" : undefined,
    request: { url: request.endpoint, method: request.method, body: request.body },
  };
}

export function prepareMixedMistakeSubmission(input: DraftInput & {
  preview: MixedMistakePreview; excludeUnavailableConfirmed: boolean; banksConfirmed: boolean;
}, nowMilliseconds: number): AssignmentSubmissionPreparationResult<MixedMistakeResult> {
  function invalid(message: string, fieldPath = "preview"): AssignmentSubmissionPreparationResult<MixedMistakeResult> {
    return { ok: false, error: { kind: "invalid_request", fieldPath, message, retryable: false, recovery: "none" } };
  }
  const issue = validateSingleAssignmentSubmission(input.draft, input.resolved, nowMilliseconds)[0];
  if (issue) return invalid(issue.message, issue.path);
  const parsed = mixedMistakePreviewSchema.safeParse(input.preview);
  if (!parsed.success || parsed.data.error || !parsed.data.selectionFingerprint ||
    parsed.data.totalQuestionCount !== input.resolved.questionCount) return invalid("최신 미리보기를 확인해 주세요.");
  const preview = parsed.data;
  if (preview.unavailableCount > 0 && !input.excludeUnavailableConfirmed) return invalid("제외되는 오답을 확인해 주세요.");
  if (preview.banks.length > 1 && !input.banksConfirmed) return invalid("나누어 배정할 시험을 확인해 주세요.");
  let request: ReturnType<typeof buildMixedMistakePreviewRequest>;
  try { request = buildMixedMistakePreviewRequest(input.draft, input.resolved); }
  catch { return invalid("혼합 배정 조건을 다시 확인해 주세요."); }
  // Capture the exact settings and bank counts; recovery must keep this request even after the deadline.
  const body = structuredClone({ ...request.body, selectionFingerprint: preview.selectionFingerprint!,
    excludeUnavailableConfirmed: input.excludeUnavailableConfirmed, banksConfirmed: input.banksConfirmed });
  const expectedCounts = preview.banks.map(bank => bank.questionCount);
  return { ok: true, value: {
    fallback: "범위와 오답 시험을 배정하지 못했습니다.",
    fingerprint: assignmentRequestFingerprint(body),
    parse: data => {
      const result = mixedMistakeResultSchema.parse(data);
      if (result.assignments.length !== expectedCounts.length ||
        result.assignments.some((item, index) => item.studentId !== body.studentId || item.questionCount !== expectedCounts[index])) {
        throw new Error("저장된 시험과 미리보기의 내용이 다릅니다.");
      }
      return result;
    },
    recoveryForResponse: response => {
      if (response.status !== 409) return undefined;
      const code = response.data && typeof response.data === "object" && "code" in response.data ? response.data.code : null;
      return code === "request_conflict" || code === "idempotency_key_reused" ? "none" : "refresh_preview";
    },
    request: key => {
      const saved = buildMixedMistakeSaveRequest(body, key);
      return { url: saved.endpoint, method: saved.method, body: saved.body };
    },
  } };
}
