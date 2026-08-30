import type {
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  BulkSeriesAssignmentDraft,
  ExamTiming,
} from "./model";

export type BulkSeriesAssignmentDraftAction =
  | { type: "students/changed"; studentIds: readonly string[] }
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
  | { type: "exam/time_limit_changed"; enabled: boolean }
  | { type: "exam/passing_score_changed"; value: number }
  | { type: "exam/retry_enabled_changed"; enabled: boolean }
  | { type: "exam/retry_passing_score_changed"; value: number };

export function createInitialBulkSeriesAssignmentDraft({
  commonPlan,
  studentIds,
}: {
  commonPlan?: BulkSeriesAssignmentDraft["commonPlan"];
  studentIds: readonly string[];
}): BulkSeriesAssignmentDraft {
  return {
    kind: "bulk_series",
    studentIds: [...studentIds],
    exam: {
      directionRatio: 50,
      passingScore: 80,
      retryEnabled: true,
      retryPassingScore: 80,
      questionOrderMode: "ascending",
      timeLimitEnabled: true,
      timing: { mode: "total", totalSeconds: 300 },
    },
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
    case "common_plan/changed":
      return {
        ...draft,
        commonPlan: action.commonPlan
          ? {
              ...action.commonPlan,
              sessions: action.commonPlan.sessions.map((session) => ({
                ...session,
                unitIds: [...session.unitIds],
              })),
              recurrenceSessions: action.commonPlan.recurrenceSessions.map(
                (session) => ({ ...session }),
              ),
              unitAllocationRule: action.commonPlan.unitAllocationRule
                ? {
                    ...action.commonPlan.unitAllocationRule,
                    weekdayUnitsPerSession: {
                      ...action.commonPlan.unitAllocationRule
                        .weekdayUnitsPerSession,
                    },
                  }
                : null,
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
    case "exam/time_limit_changed":
      return {
        ...draft,
        exam: { ...draft.exam, timeLimitEnabled: action.enabled },
      };
    case "exam/passing_score_changed":
      return {
        ...draft,
        exam: { ...draft.exam, passingScore: action.value },
      };
    case "exam/retry_enabled_changed":
      return {
        ...draft,
        exam: { ...draft.exam, retryEnabled: action.enabled },
      };
    case "exam/retry_passing_score_changed":
      return {
        ...draft,
        exam: { ...draft.exam, retryPassingScore: action.value },
      };
  }
}
