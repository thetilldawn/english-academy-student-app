import { assignmentQuestionModePolicy } from "./assignment-question-mode-policy";
import type {
  AssignmentDirectionRatio,
  AssignmentQuestionMode,
  AssignmentQuestionOrderMode,
  BulkSeriesAssignmentDraft,
  ExamTiming,
} from "./model";

export type BulkSeriesAssignmentDraftAction =
  | { type: "audience/changed"; audienceMode: "single" | "bulk" | undefined }
  | { type: "grade/acknowledged"; token: string }
  | { type: "students/changed"; studentIds: readonly string[] }
  | {
      type: "common_plan/changed";
      commonPlan: BulkSeriesAssignmentDraft["commonPlan"];
    }
  | { type: "exam/direction_changed"; value: AssignmentDirectionRatio }
  | { type: "exam/question_mode_changed"; value: AssignmentQuestionMode }
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
  audienceMode,
  commonPlan,
  studentIds,
}: {
  audienceMode?: "single" | "bulk";
  commonPlan?: BulkSeriesAssignmentDraft["commonPlan"];
  studentIds: readonly string[];
}): BulkSeriesAssignmentDraft {
  return {
    ...(audienceMode ? { audienceMode } : {}),
    kind: "bulk_series",
    questionMode: "book_meaning_choice",
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
    case "audience/changed":
      return { ...draft, audienceMode: action.audienceMode, gradeReviewToken: undefined };
    case "grade/acknowledged":
      return { ...draft, gradeReviewToken: action.token };
    case "students/changed":
      return { ...draft, studentIds: [...action.studentIds], gradeReviewToken: undefined };
    case "common_plan/changed":
      return {
        ...draft,
        gradeReviewToken: draft.commonPlan?.datasetId === action.commonPlan?.datasetId
          ? draft.gradeReviewToken : undefined,
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
    case "exam/question_mode_changed":
      return {
        ...draft,
        questionMode: action.value,
        exam: {
          ...draft.exam,
          directionRatio: assignmentQuestionModePolicy(action.value).fixedDirectionRatio ?? draft.exam.directionRatio,
        },
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
