import { describe, expect, it } from "vitest";

import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import {
  createAssignmentEditorState,
  reduceAssignmentEditorState,
} from "./editor-state";
import type { SingleAssignmentDraft } from "./model";

const draft: SingleAssignmentDraft = {
  kind: "single",
  operation: { mode: "create" },
  studentId: assignmentContractIds.studentA,
  title: { mode: "automatic" },
  range: {
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: [assignmentContractIds.day60],
  },
  questionCount: { mode: "automatic", value: 20 },
  exam: {
    directionRatio: 50,
    questionOrderMode: "random",
    passingScore: 80,
    timing: { mode: "total", totalSeconds: 300 },
  },
  availability: { mode: "immediate" },
  deadline: { mode: "none" },
  review: { mode: "none", scope: "dataset", levels: [1, 2] },
};

type Preview = { maximumQuestionCount: number };
type Result = { assignmentId: string };

function initialState() {
  return createAssignmentEditorState<
    SingleAssignmentDraft,
    Preview,
    Result
  >(draft);
}

function readyState(
  value: Preview = { maximumQuestionCount: 20 },
) {
  const loading = reduceAssignmentEditorState(initialState(), {
    type: "preview/requested",
    revision: 0,
    requestId: "verified-capacity",
    fingerprint: "selection",
  });
  return reduceAssignmentEditorState(loading, {
    type: "preview/succeeded",
    revision: 0,
    requestId: "verified-capacity",
    fingerprint: "selection",
    value,
  });
}

describe("assignment editor reducer", () => {
  it("ignores a preview request that starts after its draft revision became stale", () => {
    const initial = initialState();
    const changed = reduceAssignmentEditorState(initial, {
      type: "draft/replaced",
      draft: {
        ...draft,
        range: {
          ...draft.range,
          orderedUnitIds: [assignmentContractIds.day59],
        },
      },
    });
    const unchanged = reduceAssignmentEditorState(changed, {
      type: "preview/requested",
      revision: 0,
      requestId: "late-old-request",
      fingerprint: "old",
    });

    expect(unchanged).toBe(changed);
    expect(unchanged.preview).toStrictEqual({ status: "idle" });
  });

  it("ignores an old preview response after a newer request started", () => {
    let state = initialState();
    state = reduceAssignmentEditorState(state, {
      type: "preview/requested",
      revision: 0,
      requestId: "old",
      fingerprint: "a",
    });
    state = reduceAssignmentEditorState(state, {
      type: "preview/requested",
      revision: 0,
      requestId: "new",
      fingerprint: "b",
    });
    const unchanged = reduceAssignmentEditorState(state, {
      type: "preview/succeeded",
      revision: 0,
      requestId: "old",
      fingerprint: "a",
      value: { maximumQuestionCount: 10 },
    });
    const ready = reduceAssignmentEditorState(unchanged, {
      type: "preview/succeeded",
      revision: 0,
      requestId: "new",
      fingerprint: "b",
      value: { maximumQuestionCount: 20 },
    });

    expect(unchanged).toBe(state);
    expect(ready.preview).toStrictEqual({
      status: "ready",
      revision: 0,
      requestId: "new",
      fingerprint: "b",
      value: { maximumQuestionCount: 20 },
    });
  });

  it("stores current preview success and failure as terminal states", () => {
    const loadingSuccess = reduceAssignmentEditorState(initialState(), {
      type: "preview/requested",
      revision: 0,
      requestId: "preview-success",
      fingerprint: "success",
    });
    const ready = reduceAssignmentEditorState(loadingSuccess, {
      type: "preview/succeeded",
      revision: 0,
      requestId: "preview-success",
      fingerprint: "success",
      value: { maximumQuestionCount: 30 },
    });
    expect(ready.preview).toMatchObject({
      status: "ready",
      value: { maximumQuestionCount: 30 },
    });

    const loadingFailure = reduceAssignmentEditorState(initialState(), {
      type: "preview/requested",
      revision: 0,
      requestId: "preview-failure",
      fingerprint: "failure",
    });
    const failed = reduceAssignmentEditorState(loadingFailure, {
      type: "preview/failed",
      revision: 0,
      requestId: "preview-failure",
      fingerprint: "failure",
      message: "범위를 계산하지 못했습니다.",
    });
    expect(failed.preview).toMatchObject({
      status: "error",
      message: "범위를 계산하지 못했습니다.",
    });
  });

  it("draft changes increment revision and clear preview when no submission is active", () => {
    const state = reduceAssignmentEditorState(initialState(), {
      type: "preview/requested",
      revision: 0,
      requestId: "preview",
      fingerprint: "selection",
    });
    const changedDraft: SingleAssignmentDraft = {
      ...draft,
      questionCount: { mode: "manual", value: 5 },
    };
    const changed = reduceAssignmentEditorState(state, {
      type: "draft/replaced",
      draft: changedDraft,
    });

    expect(changed.draft).toBe(changedDraft);
    expect(changed.revision).toBe(1);
    expect(changed.preview).toStrictEqual({ status: "idle" });
    expect(changed.submission).toStrictEqual({ status: "idle" });
  });

  it("preserves a compatible preview for draft-only presentation changes", () => {
    const state = readyState();
    const changedDraft: SingleAssignmentDraft = {
      ...draft,
      title: { mode: "custom", value: "새 제목" },
    };
    const changed = reduceAssignmentEditorState(state, {
      type: "draft/replaced",
      draft: changedDraft,
      previewImpact: "preserve",
    });

    expect(changed.draft).toBe(changedDraft);
    expect(changed.revision).toBe(state.revision);
    expect(changed.preview).toBe(state.preview);
    expect(changed.submission).toStrictEqual({ status: "idle" });
  });

  it("atomically stores a preview and reconciled non-projection fields", () => {
    const loading = reduceAssignmentEditorState(initialState(), {
      type: "preview/requested",
      revision: 0,
      requestId: "capacity",
      fingerprint: "selection",
    });
    const reconciledDraft: SingleAssignmentDraft = {
      ...draft,
      questionCount: { mode: "automatic", value: 35 },
    };
    const reconciled = reduceAssignmentEditorState(loading, {
      type: "preview/reconciled",
      revision: 0,
      requestId: "capacity",
      fingerprint: "selection",
      value: { maximumQuestionCount: 35 },
      reconciliation: {
        kind: "single_capacity",
        minimumQuestionCount: 1,
        maximumQuestionCount: 35,
        recommendedQuestionCount: 35,
        minimumAllowedQuestionCount: 1,
      },
    });

    expect(reconciled.draft).toStrictEqual(reconciledDraft);
    expect(reconciled.revision).toBe(0);
    expect(reconciled.preview).toStrictEqual({
      status: "ready",
      revision: 0,
      requestId: "capacity",
      fingerprint: "selection",
      value: { maximumQuestionCount: 35 },
    });
  });

  it("reconciles only capacity-controlled fields and cannot replace the draft identity", () => {
    const loading = reduceAssignmentEditorState(initialState(), {
      type: "preview/requested",
      revision: 0,
      requestId: "capacity",
      fingerprint: "selection",
    });
    const reconciled = reduceAssignmentEditorState(loading, {
      type: "preview/reconciled",
      revision: 0,
      requestId: "capacity",
      fingerprint: "selection",
      value: { maximumQuestionCount: 7 },
      reconciliation: {
        kind: "single_capacity",
        minimumQuestionCount: 1,
        maximumQuestionCount: 7,
        recommendedQuestionCount: 7,
        minimumAllowedQuestionCount: 1,
      },
    });

    expect(reconciled.draft).toStrictEqual({
      ...draft,
      questionCount: { mode: "automatic", value: 7 },
    });
    expect(reconciled.draft.studentId).toBe(draft.studentId);
    expect(reconciled.draft.range).toStrictEqual(draft.range);
  });

  it("requires a ready capacity preview from the current revision before submit", () => {
    const initial = initialState();
    const withoutPreview = reduceAssignmentEditorState(initial, {
      type: "submission/requested",
      revision: 0,
      requestId: "submit",
      fingerprint: "payload",
    });
    const loading = reduceAssignmentEditorState(initial, {
      type: "preview/requested",
      revision: 0,
      requestId: "capacity",
      fingerprint: "selection",
    });
    const whileLoading = reduceAssignmentEditorState(loading, {
      type: "submission/requested",
      revision: 0,
      requestId: "submit",
      fingerprint: "payload",
    });
    const verified = readyState();
    const submitting = reduceAssignmentEditorState(verified, {
      type: "submission/requested",
      revision: 0,
      requestId: "submit",
      fingerprint: "payload",
    });

    expect(withoutPreview).toBe(initial);
    expect(whileLoading).toBe(loading);
    expect(submitting.submission).toMatchObject({
      status: "submitting",
      requestId: "submit",
    });
  });

  it("ignores a second submit request while the current one is pending", () => {
    const submitting = reduceAssignmentEditorState(readyState(), {
      type: "submission/requested",
      revision: 0,
      requestId: "first",
      fingerprint: "first-payload",
    });
    const unchanged = reduceAssignmentEditorState(submitting, {
      type: "submission/requested",
      revision: 0,
      requestId: "second",
      fingerprint: "second-payload",
    });

    expect(unchanged).toBe(submitting);
  });

  it("requires an explicit reset before retrying a terminal submission", () => {
    const submitting = reduceAssignmentEditorState(readyState(), {
      type: "submission/requested",
      revision: 0,
      requestId: "first",
      fingerprint: "payload",
    });
    const failed = reduceAssignmentEditorState(submitting, {
      type: "submission/failed",
      revision: 0,
      requestId: "first",
      message: "failed",
    });
    const blocked = reduceAssignmentEditorState(failed, {
      type: "submission/requested",
      revision: 0,
      requestId: "retry-without-reset",
      fingerprint: "payload",
    });
    const reset = reduceAssignmentEditorState(failed, {
      type: "submission/reset",
    });
    const retrying = reduceAssignmentEditorState(reset, {
      type: "submission/requested",
      revision: 0,
      requestId: "retry-after-reset",
      fingerprint: "payload",
    });

    expect(blocked).toBe(failed);
    expect(retrying.submission).toMatchObject({
      status: "submitting",
      requestId: "retry-after-reset",
    });
  });

  it("keeps the active submission registered until a terminal action arrives", () => {
    const submitting = reduceAssignmentEditorState(readyState(), {
      type: "submission/requested",
      revision: 0,
      requestId: "active",
      fingerprint: "payload",
    });
    const changedDraft: SingleAssignmentDraft = {
      ...draft,
      questionCount: { mode: "manual", value: 10 },
    };

    expect(
      reduceAssignmentEditorState(submitting, {
        type: "draft/replaced",
        draft: changedDraft,
      }),
    ).toBe(submitting);
    expect(
      reduceAssignmentEditorState(submitting, {
        type: "preview/reconciled",
        revision: 0,
        requestId: "preview-before-submit",
        fingerprint: "selection",
        value: { maximumQuestionCount: 35 },
        reconciliation: {
          kind: "single_capacity",
          minimumQuestionCount: 1,
          maximumQuestionCount: 35,
          recommendedQuestionCount: 35,
          minimumAllowedQuestionCount: 1,
        },
      }),
    ).toBe(submitting);
    expect(
      reduceAssignmentEditorState(submitting, {
        type: "submission/reset",
      }),
    ).toBe(submitting);
    expect(
      reduceAssignmentEditorState(submitting, {
        type: "preview/requested",
        revision: 0,
        requestId: "preview-during-submit",
        fingerprint: "selection",
      }),
    ).toBe(submitting);
  });

  it("stores current submit success, failure, and conflict", () => {
    const submittingSuccess = reduceAssignmentEditorState(readyState(), {
      type: "submission/requested",
      revision: 0,
      requestId: "success",
      fingerprint: "payload-success",
    });
    const succeeded = reduceAssignmentEditorState(submittingSuccess, {
      type: "submission/succeeded",
      revision: 0,
      requestId: "success",
      result: { assignmentId: "created" },
    });
    expect(succeeded.submission).toMatchObject({
      status: "succeeded",
      result: { assignmentId: "created" },
    });

    const submittingFailure = reduceAssignmentEditorState(readyState(), {
      type: "submission/requested",
      revision: 0,
      requestId: "failure",
      fingerprint: "payload-failure",
    });
    const failed = reduceAssignmentEditorState(submittingFailure, {
      type: "submission/failed",
      revision: 0,
      requestId: "failure",
      message: "저장하지 못했습니다.",
    });
    expect(failed.submission).toMatchObject({
      status: "failed",
      message: "저장하지 못했습니다.",
    });

    const submittingConflict = reduceAssignmentEditorState(readyState(), {
      type: "submission/requested",
      revision: 0,
      requestId: "conflict",
      fingerprint: "payload-conflict",
    });
    const conflict = reduceAssignmentEditorState(submittingConflict, {
      type: "submission/conflicted",
      revision: 0,
      requestId: "conflict",
      message: "출제 가능 수가 변경되었습니다.",
    });
    expect(conflict.draft).toBe(draft);
    expect(conflict.preview).toStrictEqual({ status: "idle" });
    expect(conflict.submission).toMatchObject({ status: "conflict" });
  });

  it("ignores stale submit terminals, including terminals arriving after reset", () => {
    const submitting = reduceAssignmentEditorState(readyState(), {
      type: "submission/requested",
      revision: 0,
      requestId: "current",
      fingerprint: "payload",
    });
    for (const action of [
      {
        type: "submission/succeeded" as const,
        revision: 0,
        requestId: "old",
        result: { assignmentId: "old" },
      },
      {
        type: "submission/conflicted" as const,
        revision: 0,
        requestId: "old",
        message: "old conflict",
      },
      {
        type: "submission/failed" as const,
        revision: 0,
        requestId: "old",
        message: "old failure",
      },
    ]) {
      expect(reduceAssignmentEditorState(submitting, action)).toBe(
        submitting,
      );
    }

    const failed = reduceAssignmentEditorState(submitting, {
      type: "submission/failed",
      revision: 0,
      requestId: "current",
      message: "failed",
    });
    const reset = reduceAssignmentEditorState(failed, {
      type: "submission/reset",
    });
    const lateSuccess = reduceAssignmentEditorState(reset, {
      type: "submission/succeeded",
      revision: 0,
      requestId: "current",
      result: { assignmentId: "late" },
    });
    expect(lateSuccess).toBe(reset);
  });
});
