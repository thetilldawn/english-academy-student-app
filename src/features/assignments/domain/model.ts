export const assignmentQuestionOrderModes = [
  "ascending",
  "descending",
  "random",
] as const;

export const MAXIMUM_BULK_STUDENT_COUNT = 210;
export const MAXIMUM_BULK_ASSIGNMENT_COUNT = 210;

export type AssignmentQuestionOrderMode =
  (typeof assignmentQuestionOrderModes)[number];
export type AssignmentDirectionRatio = 0 | 50 | 100;
export type ReviewLevel = 1 | 2;
export type ReviewScope = "dataset" | "selection";

export type ExamTiming =
  | { mode: "total"; totalSeconds: number }
  | { mode: "per_question"; perQuestionSeconds: number };

export type ExamSettings = {
  directionRatio: AssignmentDirectionRatio;
  questionOrderMode: AssignmentQuestionOrderMode;
  passingScore: number;
  retryEnabled?: boolean;
  retryPassingScore?: number;
  timeLimitEnabled?: boolean;
  timing: ExamTiming;
};

export type ReviewPolicy =
  | {
      mode: "none";
      scope: ReviewScope;
      levels: readonly ReviewLevel[];
    }
  | {
      mode: "pending";
      scope: ReviewScope;
      levels: readonly ReviewLevel[];
    };

export type BulkReviewPolicy =
  | { mode: "none"; levels: readonly ReviewLevel[] }
  | { mode: "pending"; levels: readonly ReviewLevel[] };

export type AssignmentDeadline =
  | { mode: "none" }
  | { mode: "at"; koreanLocalDateTime: string };

export type AssignmentAvailability =
  | { mode: "immediate" }
  | { mode: "at"; koreanLocalDateTime: string };

export type DirectReviewAssignmentDraft = {
  studentId: string;
  datasetId: string;
  reviewLevels: readonly ReviewLevel[];
  questionCount: number;
  title: string;
  exam: ExamSettings;
  deadline: AssignmentDeadline;
};

export type AssignmentRange = {
  datasetId: string;
  orderedUnitIds: readonly string[];
};

export type AssignmentTitleChoice =
  | { mode: "automatic" }
  | { mode: "source"; value: string }
  | { mode: "custom"; value: string };

export type AssignmentQuestionCountChoice =
  | { mode: "automatic"; value: number }
  | { mode: "manual"; value: number };

export type ExactReviewLockedShape = {
  datasetId: string;
  orderedUnitIds: readonly string[];
  questionCount: number;
  reviewScope: ReviewScope;
  reviewLevels: readonly ReviewLevel[];
};

export type SingleAssignmentOperation =
  | { mode: "create" }
  | {
      mode: "replace";
      assignmentId: string;
      targetStudentId: string;
      sourcePurpose: "regular" | "mixed";
      seriesItem?: boolean;
    }
  | {
      mode: "replace";
      assignmentId: string;
      targetStudentId: string;
      sourcePurpose: "review";
      seriesItem?: boolean;
      lockedShape: ExactReviewLockedShape;
    };

export type SingleAssignmentDraft = {
  kind: "single";
  operation: SingleAssignmentOperation;
  studentId: string;
  title: AssignmentTitleChoice;
  range: AssignmentRange;
  questionCount: AssignmentQuestionCountChoice;
  exam: ExamSettings;
  availability: AssignmentAvailability;
  deadline: AssignmentDeadline;
  review: ReviewPolicy;
};

export type ResolvedSingleAssignment = {
  displayTitle: string;
  submissionTitle: string;
  questionCount: number;
};

export type BulkAssignmentRange = {
  mode: "previous_span" | "fixed_span";
  unitsPerSession: number;
  sessionCount: number;
};

export type BulkCommonPlanSession = {
  availableLocalDateTime: string;
  deadlineLocalDateTime: string | null;
  unitIds: readonly string[];
};

export type BulkCollisionDecision = {
  collisionId: string;
  mode: "skip" | "move" | "allow";
  movedAvailableLocalDateTime?: string;
  movedDeadlineLocalDateTime?: string;
};

export type BulkCommonAssignmentPlan = {
  datasetId: string;
  distribution: "split" | "repeat";
  splitBasis: "question_count" | "range_unit";
  orderedUnitIds: readonly string[];
  rangeUnitCounts: readonly number[];
  questionCount:
    | { mode: "all" }
    | { mode: "manual"; value: number };
  overflowPolicy: "leave" | "continue_weekly";
  extraDatePolicy: "unconfirmed" | "repeat_from_start";
  selectedDateCount: number;
  selectionMode: "source_order" | "random";
  planNonce: string;
  sessions: readonly BulkCommonPlanSession[];
  recurrenceSessions: readonly Omit<BulkCommonPlanSession, "unitIds">[];
  collisionDecisions: readonly BulkCollisionDecision[];
};

export type BulkSeriesAssignmentDraft = {
  kind: "bulk_series";
  studentIds: readonly string[];
  range: BulkAssignmentRange;
  firstAvailableDateKorean: string;
  firstDeadline: AssignmentDeadline;
  dayInterval: number;
  exam: ExamSettings;
  review: BulkReviewPolicy;
  commonPlan?: BulkCommonAssignmentPlan;
};

export type LegacyReviewRecoveryDraft = {
  kind: "legacy_review_recovery";
  studentId: string;
  reviewDraftId: string;
};

export type AssignmentDraft =
  | SingleAssignmentDraft
  | BulkSeriesAssignmentDraft
  | LegacyReviewRecoveryDraft;

export function normalizeLegacyQuestionOrderMode(
  mode: AssignmentQuestionOrderMode | "fixed",
): AssignmentQuestionOrderMode {
  return mode === "fixed" ? "ascending" : mode;
}
