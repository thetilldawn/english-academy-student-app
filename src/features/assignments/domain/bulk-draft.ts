import type {
  AssignmentDeadline,
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  BulkSeriesAssignmentDraft,
  ExamTiming,
  ReviewLevel,
} from "./model";

export type BulkSeriesAssignmentDraftAction =
  | { type: "students/changed"; studentIds: readonly string[] }
  | {
      type: "range/changed";
      range: BulkSeriesAssignmentDraft["range"];
    }
  | { type: "schedule/date_changed"; value: string }
  | { type: "schedule/interval_changed"; value: number }
  | { type: "deadline/changed"; deadline: AssignmentDeadline }
  | {
      type: "common_plan/changed";
      commonPlan: BulkSeriesAssignmentDraft["commonPlan"];
    }
  | { type: "exam/direction_changed"; value: AssignmentDirectionRatio }
  | {
      type: "exam/order_changed";
      value: AssignmentQuestionOrderMode;
    }
  | { type: "exam/timing_changed"; timing: ExamTiming }
  | { type: "exam/passing_score_changed"; value: number }
  | { type: "review/levels_changed"; levels: readonly ReviewLevel[] };

export function createInitialBulkSeriesAssignmentDraft({
  firstAvailableDateKorean,
  includePendingReview,
  commonPlan,
  studentIds,
}: {
  firstAvailableDateKorean: string;
  includePendingReview: boolean;
  commonPlan?: BulkSeriesAssignmentDraft["commonPlan"];
  studentIds: readonly string[];
}): BulkSeriesAssignmentDraft {
  return {
    kind: "bulk_series",
    studentIds: [...studentIds],
    range: {
      mode: "previous_span",
      unitsPerSession: 1,
      sessionCount: commonPlan?.sessions.length ?? 1,
    },
    firstAvailableDateKorean,
    firstDeadline: { mode: "none" },
    dayInterval: 1,
    exam: {
      directionRatio: 50,
      passingScore: 80,
      questionOrderMode: "random",
      timing: { mode: "total", totalSeconds: 300 },
    },
    review: includePendingReview
      ? { mode: "pending", levels: [1, 2] }
      : { mode: "none", levels: [1, 2] },
    commonPlan,
  };
}

export function reduceBulkSeriesAssignmentDraft(
  draft: BulkSeriesAssignmentDraft,
  action: BulkSeriesAssignmentDraftAction,
): BulkSeriesAssignmentDraft {
  switch (action.type) {
    case "students/changed":
      return { ...draft, studentIds: [...action.studentIds] };
    case "range/changed":
      return { ...draft, range: { ...action.range } };
    case "schedule/date_changed":
      return { ...draft, firstAvailableDateKorean: action.value };
    case "schedule/interval_changed":
      return { ...draft, dayInterval: action.value };
    case "deadline/changed":
      return { ...draft, firstDeadline: action.deadline };
    case "common_plan/changed":
      return {
        ...draft,
        range: action.commonPlan
          ? {
              ...draft.range,
              mode: "fixed_span",
              sessionCount: action.commonPlan.sessions.length,
            }
          : draft.range,
        commonPlan: action.commonPlan
          ? {
              ...action.commonPlan,
              sessions: action.commonPlan.sessions.map((session) => ({
                ...session,
                unitIds: [...session.unitIds],
              })),
              collisionDecisions:
                action.commonPlan.collisionDecisions.map((decision) => ({
                  ...decision,
                })),
            }
          : undefined,
      };
    case "exam/direction_changed":
      return {
        ...draft,
        exam: { ...draft.exam, directionRatio: action.value },
      };
    case "exam/order_changed":
      return {
        ...draft,
        exam: { ...draft.exam, questionOrderMode: action.value },
      };
    case "exam/timing_changed":
      return { ...draft, exam: { ...draft.exam, timing: action.timing } };
    case "exam/passing_score_changed":
      return {
        ...draft,
        exam: { ...draft.exam, passingScore: action.value },
      };
    case "review/levels_changed":
      return {
        ...draft,
        review: { ...draft.review, levels: [...action.levels] },
      };
  }
}
