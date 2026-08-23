export type AssignmentReplacementFingerprintFields = {
  title: string;
  datasetId: string;
  primaryUnitIds: readonly string[];
  includePendingReview: boolean;
  reviewLevels: readonly number[];
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  timingMode: string;
  questionTimeLimitSeconds: number | null;
  passingScore: number;
  retryEnabled: boolean;
  retryPassingScore: number | null;
  questionOrderMode: string;
  availableUntil: string | null;
};

/**
 * The exact semantic input shared by the client retry reservation and the
 * server replacement idempotency hash. Keep the property order stable: the
 * server's persisted SHA-256 contract serializes this object directly.
 */
export function assignmentReplacementFingerprintPayload(
  assignmentId: string,
  studentId: string,
  input: AssignmentReplacementFingerprintFields,
) {
  return {
    assignmentId,
    studentId,
    title: input.title.trim(),
    datasetId: input.datasetId,
    primaryUnitIds: [...input.primaryUnitIds],
    includePendingReview: input.includePendingReview,
    reviewLevels: input.includePendingReview
      ? [...input.reviewLevels].toSorted()
      : [],
    questionCount: input.questionCount,
    englishToKoreanRatio: input.englishToKoreanRatio,
    timeLimitSeconds: input.timeLimitSeconds,
    timingMode: input.timingMode,
    questionTimeLimitSeconds: input.questionTimeLimitSeconds,
    passingScore: input.passingScore,
    retryEnabled: input.retryEnabled,
    retryPassingScore: input.retryPassingScore,
    questionOrderMode: input.questionOrderMode,
    availableUntil: input.availableUntil,
  };
}
