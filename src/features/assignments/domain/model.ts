export const assignmentQuestionOrderModes = [
  "ascending",
  "descending",
  "random",
] as const;

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
  reviewLevels: readonly ReviewLevel[];
};

export type SingleAssignmentOperation =
  | { mode: "create" }
  | {
      mode: "replace";
      assignmentId: string;
      targetStudentId: string;
      sourcePurpose: "regular" | "mixed";
    }
  | {
      mode: "replace";
      assignmentId: string;
      targetStudentId: string;
      sourcePurpose: "review";
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
  deadlineLocalDateTime: string;
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
  targetWordsPerSession: number;
  sessions: readonly BulkCommonPlanSession[];
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
