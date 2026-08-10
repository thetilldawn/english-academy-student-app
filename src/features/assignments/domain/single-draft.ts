import type {
  AssignmentDeadline,
  AssignmentRange,
  ExamSettings,
  ResolvedSingleAssignment,
  ReviewPolicy,
  SingleAssignmentOperation,
  SingleAssignmentDraft,
} from "./model";

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
  | { type: "deadline/changed"; deadline: AssignmentDeadline }
  | { type: "review/changed"; review: ReviewPolicy };

type ExactReviewReplacementOperation = Extract<
  SingleAssignmentOperation,
  { mode: "replace"; sourcePurpose: "review" }
>;

function isExactReviewReplacement(
  draft: SingleAssignmentDraft,
): draft is SingleAssignmentDraft & {
  operation: ExactReviewReplacementOperation;
} {
  return (
    draft.operation.mode === "replace" &&
    draft.operation.sourcePurpose === "review"
  );
}

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
    if (isExactReviewReplacement(draft)) return draft;
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
    if (isExactReviewReplacement(draft)) return draft;
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
    return { ...draft, title: { mode: "custom", value: action.value } };
  }
  if (action.type === "title/restoreAutomatic") {
    return { ...draft, title: { mode: "automatic" } };
  }
  if (action.type === "questionCount/manuallyChanged") {
    if (
      isExactReviewReplacement(draft) &&
      action.value !== draft.operation.lockedShape.questionCount
    ) {
      return draft;
    }
    return {
      ...draft,
      questionCount: { mode: "manual", value: action.value },
    };
  }
  if (action.type === "questionCount/restoreAutomatic") {
    if (isExactReviewReplacement(draft)) return draft;
    return {
      ...draft,
      questionCount: {
        mode: "automatic",
        value: action.recommendedQuestionCount,
      },
    };
  }
  if (action.type === "capacity/reconciled") {
    if (isExactReviewReplacement(draft)) return draft;
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
    return { ...draft, exam: action.exam };
  }
  if (action.type === "deadline/changed") {
    return { ...draft, deadline: action.deadline };
  }
  if (isExactReviewReplacement(draft)) return draft;
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
