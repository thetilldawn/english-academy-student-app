export type ReviewLevel = 1 | 2;

type CommonAssignmentInput = {
  studentId: string;
  datasetId: string;
  primaryUnitIds: string[];
  title: string;
  questionCount: number;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  passingScore: number;
  questionOrderMode: "fixed" | "random";
  availableUntil: string | null;
};

type RegularAssignmentInput = CommonAssignmentInput & {
  includePendingReview: false;
};

type MixedAssignmentInput = CommonAssignmentInput & {
  includePendingReview: true;
  reviewLevels: ReviewLevel[];
  reviewLimit: number;
};

export type AssignmentSubmissionInput =
  | RegularAssignmentInput
  | MixedAssignmentInput;

export type AssignmentSubmission = {
  endpoint:
    | "/api/admin/assignments"
    | "/api/admin/mixed-assignments";
  body: Record<string, unknown>;
};

export function defaultReviewLevels(): ReviewLevel[] {
  return [1, 2];
}

export function toggleReviewLevel(
  levels: readonly ReviewLevel[],
  level: ReviewLevel,
): ReviewLevel[] {
  if (!levels.includes(level)) {
    return [...levels, level].toSorted();
  }
  if (levels.length === 1) return [...levels];
  return levels.filter((candidate) => candidate !== level);
}

export function buildAssignmentSubmission(
  input: AssignmentSubmissionInput,
): AssignmentSubmission {
  if (input.includePendingReview) {
    return {
      endpoint: "/api/admin/mixed-assignments",
      body: {
        studentId: input.studentId,
        datasetId: input.datasetId,
        primaryUnitIds: [...input.primaryUnitIds],
        reviewLevels: [...input.reviewLevels],
        reviewLimit: input.reviewLimit,
        totalQuestionCount: input.questionCount,
        title: input.title,
        englishToKoreanRatio: input.englishToKoreanRatio,
        timeLimitSeconds: input.timeLimitSeconds,
        passingScore: input.passingScore,
        questionOrderMode: input.questionOrderMode,
        availableUntil: input.availableUntil,
      },
    };
  }

  return {
    endpoint: "/api/admin/assignments",
    body: {
      title: input.title,
      datasetId: input.datasetId,
      unitIds: [...input.primaryUnitIds],
      questionCount: input.questionCount,
      englishToKoreanRatio: input.englishToKoreanRatio,
      timeLimitSeconds: input.timeLimitSeconds,
      passingScore: input.passingScore,
      questionOrderMode: input.questionOrderMode,
      availableUntil: input.availableUntil,
      studentIds: [input.studentId],
    },
  };
}
