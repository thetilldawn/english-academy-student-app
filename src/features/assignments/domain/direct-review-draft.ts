import type {
  AssignmentDeadline,
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  DirectReviewAssignmentDraft,
  ExamTiming,
  ReviewLevel,
} from "./model";

export type DirectReviewDraftAction =
  | { type: "dataset_changed"; datasetId: string; primaryUnitIds: readonly string[] }
  | { type: "review_level_toggled"; level: ReviewLevel }
  | { type: "question_count_resolved"; value: number }
  | { type: "direction_changed"; value: AssignmentDirectionRatio }
  | { type: "order_changed"; value: AssignmentQuestionOrderMode }
  | { type: "passing_score_changed"; value: number }
  | { type: "time_limit_changed"; enabled: boolean }
  | { type: "timing_changed"; timing: ExamTiming }
  | { type: "timing_mode_changed"; mode: ExamTiming["mode"] }
  | { type: "deadline_changed"; deadline: AssignmentDeadline };

export function createInitialDirectReviewDraft(input: {
  studentId: string;
  datasetId: string;
  primaryUnitIds: readonly string[];
}): DirectReviewAssignmentDraft {
  return {
    studentId: input.studentId,
    datasetId: input.datasetId,
    primaryUnitIds: [...input.primaryUnitIds],
    reviewLevels: [1, 2],
    questionCount: 0,
    title: "오답 시험",
    exam: {
      directionRatio: 50,
      questionOrderMode: "random",
      passingScore: 80,
      timeLimitEnabled: true,
      timing: { mode: "total", totalSeconds: 300 },
    },
    deadline: { mode: "none" },
  };
}

export function reduceDirectReviewDraft(
  draft: DirectReviewAssignmentDraft,
  action: DirectReviewDraftAction,
): DirectReviewAssignmentDraft {
  switch (action.type) {
    case "dataset_changed":
      return {
        ...draft,
        datasetId: action.datasetId,
        primaryUnitIds: [...action.primaryUnitIds],
        reviewLevels: [1, 2],
        questionCount: 0,
      };
    case "review_level_toggled": {
      const selected = new Set(draft.reviewLevels);
      if (selected.has(action.level)) selected.delete(action.level);
      else selected.add(action.level);
      return {
        ...draft,
        reviewLevels: ([1, 2] as const).filter((level) => selected.has(level)),
        questionCount: 0,
      };
    }
    case "question_count_resolved":
      return { ...draft, questionCount: action.value };
    case "direction_changed":
      return {
        ...draft,
        questionCount: 0,
        exam: { ...draft.exam, directionRatio: action.value },
      };
    case "order_changed":
      return {
        ...draft,
        exam: { ...draft.exam, questionOrderMode: action.value },
      };
    case "passing_score_changed":
      return { ...draft, exam: { ...draft.exam, passingScore: action.value } };
    case "time_limit_changed":
      return {
        ...draft,
        exam: { ...draft.exam, timeLimitEnabled: action.enabled },
      };
    case "timing_changed":
      return { ...draft, exam: { ...draft.exam, timing: action.timing } };
    case "timing_mode_changed":
      return {
        ...draft,
        exam: {
          ...draft.exam,
          timing:
            action.mode === "total"
              ? { mode: "total", totalSeconds: 300 }
              : { mode: "per_question", perQuestionSeconds: 20 },
        },
      };
    case "deadline_changed":
      return { ...draft, deadline: action.deadline };
  }
}
