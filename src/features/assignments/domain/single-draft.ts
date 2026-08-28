import type {
  AssignmentAvailability,
  AssignmentDeadline,
  AssignmentRange,
  ExamSettings,
  ResolvedSingleAssignment,
  ReviewPolicy,
  SingleAssignmentDraft,
} from "./model";
import { canEditSingleAssignmentField } from "./assignment-edit-policy";

export type SingleAssignmentDraftAction =
  | { type: "student/changed"; studentId: string }
  | { type: "dataset/changed"; datasetId: string }
  | { type: "range/changed"; range: AssignmentRange }
  | { type: "title/changed"; value: string }
  | { type: "title/restoreAutomatic" }
  | { type: "questionCount/manuallyChanged"; value: number }
  | {
      type: "questionCount/restoreAutomatic";
      recommendedQuestionCount: number;
    }
  | {
      type: "capacity/reconciled";
      minimumQuestionCount: number;
      maximumQuestionCount: number;
      recommendedQuestionCount: number;
      minimumAllowedQuestionCount: number;
    }
  | { type: "exam/changed"; exam: ExamSettings }
  | {
      type: "availability/changed";
      availability: AssignmentAvailability;
    }
  | { type: "deadline/changed"; deadline: AssignmentDeadline }
  | { type: "review/changed"; review: ReviewPolicy };

export function reduceSingleAssignmentDraft(
  draft: SingleAssignmentDraft,
  action: SingleAssignmentDraftAction,
): SingleAssignmentDraft {
  if (action.type === "student/changed") {
    return draft.operation.mode === "replace"
      ? draft
      : { ...draft, studentId: action.studentId };
  }
  if (action.type === "dataset/changed") {
    if (!canEditSingleAssignmentField(draft, "dataset")) return draft;
    return {
      ...draft,
      range: { datasetId: action.datasetId, orderedUnitIds: [] },
      title:
        draft.title.mode === "source"
          ? { mode: "automatic" }
          : draft.title,
    };
  }
  if (action.type === "range/changed") {
    if (!canEditSingleAssignmentField(draft, "range")) return draft;
    if (
      action.range.datasetId !== draft.range.datasetId &&
      !canEditSingleAssignmentField(draft, "dataset")
    ) {
      return draft;
    }
    return {
      ...draft,
      range: action.range,
      title:
        draft.title.mode === "source"
          ? { mode: "automatic" }
          : draft.title,
    };
  }
  if (action.type === "title/changed") {
    if (!canEditSingleAssignmentField(draft, "title")) return draft;
    return { ...draft, title: { mode: "custom", value: action.value } };
  }
  if (action.type === "title/restoreAutomatic") {
    if (!canEditSingleAssignmentField(draft, "title")) return draft;
    return { ...draft, title: { mode: "automatic" } };
  }
  if (action.type === "questionCount/manuallyChanged") {
    if (!canEditSingleAssignmentField(draft, "questionCount")) return draft;
    return {
      ...draft,
      questionCount: { mode: "manual", value: action.value },
    };
  }
  if (action.type === "questionCount/restoreAutomatic") {
    if (!canEditSingleAssignmentField(draft, "questionCount")) return draft;
    return {
      ...draft,
      questionCount: {
        mode: "automatic",
        value: action.recommendedQuestionCount,
      },
    };
  }
  if (action.type === "capacity/reconciled") {
    if (!canEditSingleAssignmentField(draft, "questionCount")) return draft;
    if (
      action.maximumQuestionCount < action.minimumQuestionCount ||
      action.maximumQuestionCount < action.minimumAllowedQuestionCount
    ) {
      return draft;
    }
    const preferred =
      draft.questionCount.mode === "automatic" &&
      action.recommendedQuestionCount >= action.minimumAllowedQuestionCount
        ? action.recommendedQuestionCount
        : draft.questionCount.value;
    const value = Math.min(
      action.maximumQuestionCount,
      Math.max(action.minimumQuestionCount, preferred),
    );
    if (value === draft.questionCount.value) return draft;
    return {
      ...draft,
      questionCount: { ...draft.questionCount, value },
    };
  }
  if (action.type === "exam/changed") {
    const policy = {
      direction: canEditSingleAssignmentField(draft, "direction"),
      order: canEditSingleAssignmentField(draft, "order"),
      passingScore: canEditSingleAssignmentField(draft, "passingScore"),
      retry: canEditSingleAssignmentField(draft, "retry"),
      timing: canEditSingleAssignmentField(draft, "timing"),
    };
    const exam = {
      ...draft.exam,
      directionRatio: policy.direction
        ? action.exam.directionRatio
        : draft.exam.directionRatio,
      questionOrderMode: policy.order
        ? action.exam.questionOrderMode
        : draft.exam.questionOrderMode,
      passingScore: policy.passingScore
        ? action.exam.passingScore
        : draft.exam.passingScore,
      retryEnabled: policy.retry
        ? action.exam.retryEnabled
        : draft.exam.retryEnabled,
      retryPassingScore: policy.retry
        ? action.exam.retryPassingScore
        : draft.exam.retryPassingScore,
      timeLimitEnabled: policy.timing
        ? action.exam.timeLimitEnabled
        : draft.exam.timeLimitEnabled,
      timing: policy.timing ? action.exam.timing : draft.exam.timing,
    };
    if (
      exam.directionRatio === draft.exam.directionRatio &&
      exam.questionOrderMode === draft.exam.questionOrderMode &&
      exam.passingScore === draft.exam.passingScore &&
      exam.retryEnabled === draft.exam.retryEnabled &&
      exam.retryPassingScore === draft.exam.retryPassingScore &&
      exam.timeLimitEnabled === draft.exam.timeLimitEnabled &&
      exam.timing === draft.exam.timing
    ) {
      return draft;
    }
    return { ...draft, exam };
  }
  if (action.type === "availability/changed") {
    if (!canEditSingleAssignmentField(draft, "availableFrom")) return draft;
    return { ...draft, availability: action.availability };
  }
  if (action.type === "deadline/changed") {
    if (!canEditSingleAssignmentField(draft, "deadline")) return draft;
    return { ...draft, deadline: action.deadline };
  }
  if (!canEditSingleAssignmentField(draft, "review")) return draft;
  return { ...draft, review: action.review };
}

export function resolveSingleAssignmentDraft(
  draft: SingleAssignmentDraft,
  automatic: { title: string },
): ResolvedSingleAssignment {
  const displayTitle =
    draft.title.mode === "automatic" ? automatic.title : draft.title.value;
  const submissionTitle =
    draft.title.mode === "automatic" && draft.operation.mode === "create"
      ? ""
      : displayTitle;
  return {
    displayTitle,
    submissionTitle,
    questionCount: draft.questionCount.value,
  };
}
