import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";

export type AssignmentEditPurpose = "regular" | "mixed" | "review";
export type AssignmentReviewSnapshotMode =
  | "none"
  | "preserve"
  | "recalculate";

export type AssignmentEditDraft = {
  assignmentId: string;
  studentId: string;
  studentName: string;
  purpose: AssignmentEditPurpose;
  title: string;
  datasetId: string;
  primaryUnitIds: string[];
  questionCount: number;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  passingScore: number;
  retryEnabled: boolean;
  retryPassingScore: number | null;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
  includePendingReview: boolean;
  reviewLevels: (1 | 2)[];
};

export type AssignmentReplacementInput = Omit<
  AssignmentEditDraft,
  "assignmentId" | "studentId" | "studentName" | "purpose"
> & {
  idempotencyKey: string;
};

export type AssignmentReplacementResult = {
  status: "replaced";
  sourceAssignmentId: string;
  replacementAssignmentId: string;
  studentId: string;
  replacementPurpose: AssignmentEditPurpose;
  idempotent: boolean;
};

export function preservedAssignmentReplacementPlan(
  sourcePurpose: AssignmentEditPurpose,
  includePendingReview: boolean,
): {
  kind: AssignmentEditPurpose;
  reviewSnapshotMode: AssignmentReviewSnapshotMode;
} {
  const kind =
    sourcePurpose === "review"
      ? "review"
      : includePendingReview
        ? "mixed"
        : "regular";
  return {
    kind,
    reviewSnapshotMode: kind === "regular" ? "none" : "preserve",
  };
}

export type AssignmentEditChangeKey =
  | "title"
  | "dataset"
  | "range"
  | "questionCount"
  | "direction"
  | "order"
  | "timing"
  | "passingScore"
  | "retry"
  | "deadline"
  | "review";

export function assignmentEditChangeKeys(
  before: AssignmentEditDraft,
  after: Omit<AssignmentReplacementInput, "idempotencyKey">,
): AssignmentEditChangeKey[] {
  const changes: AssignmentEditChangeKey[] = [];
  if (before.title !== after.title) changes.push("title");
  if (before.datasetId !== after.datasetId) changes.push("dataset");
  if (
    before.primaryUnitIds.join("\u0000") !==
    after.primaryUnitIds.join("\u0000")
  ) {
    changes.push("range");
  }
  if (before.questionCount !== after.questionCount) {
    changes.push("questionCount");
  }
  if (
    before.englishToKoreanRatio !== after.englishToKoreanRatio
  ) {
    changes.push("direction");
  }
  if (before.questionOrderMode !== after.questionOrderMode) {
    changes.push("order");
  }
  if (
    before.timingMode !== after.timingMode ||
    before.timeLimitSeconds !== after.timeLimitSeconds ||
    before.questionTimeLimitSeconds !==
      after.questionTimeLimitSeconds
  ) {
    changes.push("timing");
  }
  if (before.passingScore !== after.passingScore) {
    changes.push("passingScore");
  }
  if (
    before.retryEnabled !== after.retryEnabled ||
    before.retryPassingScore !== after.retryPassingScore
  ) {
    changes.push("retry");
  }
  if (before.availableUntil !== after.availableUntil) {
    changes.push("deadline");
  }
  if (
    before.includePendingReview !== after.includePendingReview ||
    (before.includePendingReview &&
      after.includePendingReview &&
      before.reviewLevels.join("\u0000") !==
        after.reviewLevels.join("\u0000"))
  ) {
    changes.push("review");
  }
  return changes;
}

export function isStudentAssignmentEditable(item: {
  status: string;
  attemptId: string | null;
  assignmentDeleted: boolean;
  assignmentStatus: "draft" | "active" | "closed";
  availableUntil: string | null;
  studentDeleted: boolean;
  studentStatus: "active" | "blocked";
}) {
  return (
    item.status === "not_started" &&
    item.attemptId === null &&
    !item.assignmentDeleted &&
    item.assignmentStatus === "active" &&
    !item.studentDeleted &&
    item.studentStatus === "active" &&
    (!item.availableUntil || Date.parse(item.availableUntil) > Date.now())
  );
}
