import { useMemo } from "react";

import type { AssignmentCapacityResponse } from "../api/response-adapters";
import type { PreviewState } from "../domain/editor-state";
import type {
  AssignmentAvailability,
  AssignmentDeadline,
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  ExamTiming,
  ReviewLevel,
  ReviewPolicy,
  ReviewScope,
  SingleAssignmentDraft,
} from "../domain/model";
import type { SingleAssignmentDraftAction } from "../domain/single-draft";

export type SingleAssignmentTimingMemory = {
  perQuestionSeconds: number;
  totalSeconds: number;
};

export function reduceSingleAssignmentTimingMemory(
  current: SingleAssignmentTimingMemory,
  timing: ExamTiming,
): SingleAssignmentTimingMemory {
  return timing.mode === "total"
    ? { ...current, totalSeconds: timing.totalSeconds }
    : { ...current, perQuestionSeconds: timing.perQuestionSeconds };
}

type SingleAssignmentActionState = {
  draft: SingleAssignmentDraft;
  preview: PreviewState<AssignmentCapacityResponse>;
};

export function useSingleAssignmentControllerActions<
  SubmitOutcome,
  State extends SingleAssignmentActionState,
>({
  changeDraft,
  currentState,
  rememberTiming,
  retryPreview,
  submit,
  timingMemory,
}: {
  changeDraft: (action: SingleAssignmentDraftAction) => void;
  currentState: { current: State };
  rememberTiming: (timing: ExamTiming) => void;
  retryPreview: () => void;
  submit: () => Promise<SubmitOutcome>;
  timingMemory: SingleAssignmentTimingMemory;
}) {
  return useMemo(() => ({
    changeDataset(datasetId: string) {
      changeDraft({ type: "dataset/changed", datasetId });
    },
    changeAvailability(availability: AssignmentAvailability) {
      changeDraft({ type: "availability/changed", availability });
    },
    changeDeadline(deadline: AssignmentDeadline) {
      changeDraft({ type: "deadline/changed", deadline });
    },
    changeDirection(directionRatio: AssignmentDirectionRatio) {
      changeDraft({
        type: "exam/changed",
        exam: { ...currentState.current.draft.exam, directionRatio },
      });
    },
    changeOrder(questionOrderMode: AssignmentQuestionOrderMode) {
      changeDraft({
        type: "exam/changed",
        exam: { ...currentState.current.draft.exam, questionOrderMode },
      });
    },
    changePassingScore(passingScore: number) {
      changeDraft({
        type: "exam/changed",
        exam: { ...currentState.current.draft.exam, passingScore },
      });
    },
    changeRetryEnabled(retryEnabled: boolean) {
      changeDraft({
        type: "exam/changed",
        exam: { ...currentState.current.draft.exam, retryEnabled },
      });
    },
    changeRetryPassingScore(retryPassingScore: number) {
      changeDraft({
        type: "exam/changed",
        exam: {
          ...currentState.current.draft.exam,
          retryPassingScore,
        },
      });
    },
    changeQuestionCount(value: number) {
      changeDraft({ type: "questionCount/manuallyChanged", value });
    },
    changeRange(datasetId: string, orderedUnitIds: readonly string[]) {
      changeDraft({
        type: "range/changed",
        range: { datasetId, orderedUnitIds: [...orderedUnitIds] },
      });
    },
    changeReview(review: ReviewPolicy) {
      changeDraft({ type: "review/changed", review });
    },
    changeReviewMode(mode: ReviewPolicy["mode"]) {
      changeDraft({
        type: "review/changed",
        review: { ...currentState.current.draft.review, mode },
      });
    },
    changeReviewScope(scope: ReviewScope) {
      changeDraft({
        type: "review/changed",
        review: { ...currentState.current.draft.review, scope },
      });
    },
    changeTiming(timing: ExamTiming) {
      rememberTiming(timing);
      changeDraft({
        type: "exam/changed",
        exam: { ...currentState.current.draft.exam, timing },
      });
    },
    changeTimeLimitEnabled(timeLimitEnabled: boolean) {
      changeDraft({
        type: "exam/changed",
        exam: {
          ...currentState.current.draft.exam,
          timeLimitEnabled,
        },
      });
    },
    changeTimingMode(mode: ExamTiming["mode"]) {
      const timing: ExamTiming =
        mode === "total"
          ? { mode, totalSeconds: timingMemory.totalSeconds }
          : {
              mode,
              perQuestionSeconds: timingMemory.perQuestionSeconds,
            };
      changeDraft({
        type: "exam/changed",
        exam: { ...currentState.current.draft.exam, timing },
      });
    },
    changeTitle(value: string) {
      changeDraft(
        value.trim()
          ? { type: "title/changed", value }
          : { type: "title/restoreAutomatic" },
      );
    },
    restoreAutomaticCount() {
      const preview = currentState.current.preview;
      const capacity = preview.status === "ready" ? preview.value : null;
      if (!capacity) return;
      changeDraft({
        type: "questionCount/restoreAutomatic",
        recommendedQuestionCount: capacity.recommendedQuestionCount,
      });
    },
    retryPreview,
    submit,
    toggleReviewLevel(level: ReviewLevel) {
      const current = currentState.current.draft.review;
      const levels = current.levels.includes(level)
        ? current.levels.filter((candidate) => candidate !== level)
        : [...current.levels, level].toSorted();
      changeDraft({
        type: "review/changed",
        review: { ...current, levels },
      });
    },
  }), [
    changeDraft,
    currentState,
    rememberTiming,
    retryPreview,
    submit,
    timingMemory,
  ]);
}
