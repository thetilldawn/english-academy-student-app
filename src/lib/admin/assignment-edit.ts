import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import {
  assignmentEditChangeKeys as sharedAssignmentEditChangeKeys,
  isAssignmentEditAvailable,
  type AssignmentEditFieldKey,
  type AssignmentReviewScope,
} from "@/lib/admin/assignment-edit-policy";

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
  availableFrom: string | null;
  availableUntil: string | null;
  includePendingReview: boolean;
  reviewScope: AssignmentReviewScope;
  reviewLevels: (1 | 2)[];
  seriesItem: boolean;
};

export type AssignmentReplacementInput = Omit<
  AssignmentEditDraft,
  | "assignmentId"
  | "studentId"
  | "studentName"
  | "purpose"
  | "seriesItem"
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
): {
  kind: AssignmentEditPurpose;
  reviewSnapshotMode: AssignmentReviewSnapshotMode;
} {
  const kind = sourcePurpose;
  return {
    kind,
    reviewSnapshotMode: kind === "regular" ? "none" : "preserve",
  };
}

export type AssignmentEditChangeKey = AssignmentEditFieldKey;

export function assignmentEditChangeKeys(
  before: AssignmentEditDraft,
  after: Omit<AssignmentReplacementInput, "idempotencyKey">,
): AssignmentEditChangeKey[] {
  return sharedAssignmentEditChangeKeys(before, after);
}

export function isStudentAssignmentEditable(
  item: Parameters<typeof isAssignmentEditAvailable>[0],
  nowMilliseconds = Date.now(),
) {
  return isAssignmentEditAvailable(item, nowMilliseconds);
}
