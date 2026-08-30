import "server-only";

import {
  preservedAssignmentReplacementPlan,
  type AssignmentReplacementInput,
  type AssignmentReviewSnapshotMode,
} from "@/lib/admin/assignment-edit";
import type { AssignmentCapacityInput } from "@/lib/admin/assignment-replacement-request";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  type AssignmentQuestionPlan,
  requireEditableSourceContext,
} from "@/lib/services/assignment-edit-source-service";
import {
  AssignmentReplacementError,
} from "@/lib/services/assignment-replacement-errors";
import {
  assertAssignmentEditFieldPolicy,
  assertLegacyMixedContentShape,
  assertExactReviewShape,
  canReuseSourceQuestions,
} from "@/lib/services/assignment-replacement-policy";
import {
  calculateAssignmentCapacity,
  MixedAssignmentError,
  prepareMixedAssignmentBatch,
} from "@/lib/services/mixed-assignment-service";
import {
  AssignmentCreationError,
  prepareRegularAssignment,
} from "@/lib/services/regular-assignment-service";

export async function calculateStudentAssignmentReplacementCapacity(
  assignmentId: string,
  studentId: string,
  input: AssignmentCapacityInput,
  authenticatedAdmin?: AdminContext,
  options?: { nowMilliseconds?: number },
) {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const source = await requireEditableSourceContext(
    assignmentId,
    studentId,
    admin,
    options,
  );
  if (input.studentId !== studentId) {
    throw new AssignmentReplacementError("invalid_selection");
  }
  const policyInput = {
    ...input,
    reviewScope: input.reviewScope ?? source.draft.reviewScope,
  };
  assertAssignmentEditFieldPolicy(source, policyInput);
  if (source.draft.purpose === "review") {
    assertExactReviewShape(source, {
      datasetId: input.datasetId,
      primaryUnitIds: input.primaryUnitIds,
      questionCount: source.draft.questionCount,
      englishToKoreanRatio: input.englishToKoreanRatio,
      includePendingReview: input.includePendingReview,
      reviewLevels: input.reviewLevels,
      reviewScope: policyInput.reviewScope,
    });
    const count = source.questions!.length;
    return {
      eligibleBeforeActiveAssignment: 0,
      activeAssignmentExcluded: 0,
      questionPlanExcluded: 0,
      unitEligible: 0,
      wrongEligible: count,
      wrongLevel1Eligible: source.selectedReviewLevels.filter(
        (level) => level === 1,
      ).length,
      wrongLevel2Eligible: source.selectedReviewLevels.filter(
        (level) => level === 2,
      ).length,
      overlap: 0,
      alreadyAssigned: 0,
      maximumQuestionCount: count,
      recommendedQuestionCount: count,
      minimumQuestionCount: count,
    };
  }
  if (source.draft.purpose === "mixed") {
    assertLegacyMixedContentShape(source, policyInput);
    const count = source.draft.questionCount;
    const wrongCount = source.selectedQueueIds.length;
    return {
      eligibleBeforeActiveAssignment: count,
      activeAssignmentExcluded: 0,
      questionPlanExcluded: 0,
      unitEligible: Math.max(0, count - wrongCount),
      wrongEligible: wrongCount,
      wrongLevel1Eligible: source.selectedReviewLevels.filter(
        (level) => level === 1,
      ).length,
      wrongLevel2Eligible: source.selectedReviewLevels.filter(
        (level) => level === 2,
      ).length,
      overlap: 0,
      alreadyAssigned: 0,
      maximumQuestionCount: count,
      recommendedQuestionCount: count,
      minimumQuestionCount: count,
    };
  }
  try {
    return await calculateAssignmentCapacity(input, admin, {
      assignmentId,
      studentId,
    });
  } catch (error) {
    if (error instanceof MixedAssignmentError) {
      throw new AssignmentReplacementError(
        error.reason === "forbidden"
          ? "forbidden"
          : error.reason === "database"
            ? "database"
            : error.reason === "conflict"
              ? "conflict"
              : "invalid_selection",
        error.message,
      );
    }
    throw error;
  }
}

export async function prepareStudentAssignmentReplacement(
  assignmentId: string,
  studentId: string,
  input: AssignmentReplacementInput,
  authenticatedAdmin?: AdminContext,
  options?: { nowMilliseconds?: number },
) {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const exclusion = { assignmentId, studentId };
  let replacementKind: "regular" | "mixed" | "review";
  let reviewSnapshotMode: AssignmentReviewSnapshotMode;
  let prepared: {
    title: string;
    datasetId: string;
    primaryUnitIds: string[];
    questionCount: number;
    englishToKoreanRatio: 0 | 50 | 100;
    timeLimitSeconds: number;
    passingScore: number;
    retryEnabled: boolean;
    retryPassingScore: number | null;
    questionOrderMode: AssignmentReplacementInput["questionOrderMode"];
    availableFrom: string | null;
    availableUntil: string | null;
    timingMode: AssignmentReplacementInput["timingMode"];
    questionTimeLimitSeconds: number | null;
    reviewLevels: (1 | 2)[];
    reviewScope: AssignmentReplacementInput["reviewScope"];
    selectedQueueIds: string[];
    questions: AssignmentQuestionPlan[];
  };
  try {
    const source = await requireEditableSourceContext(
      assignmentId,
      studentId,
      admin,
      options,
    );
    assertAssignmentEditFieldPolicy(source, input);
    if (source.draft.purpose === "review") {
      assertExactReviewShape(source, input);
      if (!canReuseSourceQuestions(source, input)) {
        throw new AssignmentReplacementError(
          "invalid_selection",
          "오답 시험은 기존 문제를 유지한 채 시험 조건과 일정만 수정할 수 있습니다.",
        );
      }
    }
    assertLegacyMixedContentShape(source, input);
    const effectiveReviewScope = input.includePendingReview
      ? input.reviewScope
      : source.draft.reviewScope;

    if (canReuseSourceQuestions(source, input)) {
      const replacementPlan = preservedAssignmentReplacementPlan(
        source.draft.purpose,
      );
      replacementKind = replacementPlan.kind;
      reviewSnapshotMode = replacementPlan.reviewSnapshotMode;
      prepared = {
        title: input.title.trim(),
        datasetId: input.datasetId,
        primaryUnitIds:
          replacementKind === "review" ? [] : input.primaryUnitIds,
        questionCount: input.questionCount,
        englishToKoreanRatio: input.englishToKoreanRatio,
        timeLimitSeconds: input.timeLimitSeconds,
        passingScore: input.passingScore,
        retryEnabled: input.retryEnabled,
        retryPassingScore: input.retryPassingScore,
        questionOrderMode: input.questionOrderMode,
        availableFrom: input.availableFrom,
        availableUntil: input.availableUntil,
        timingMode: input.timingMode,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds,
        reviewLevels: input.includePendingReview
          ? [...input.reviewLevels].toSorted()
          : [],
        reviewScope: effectiveReviewScope,
        selectedQueueIds: input.includePendingReview
          ? source.selectedQueueIds
          : [],
        questions: source.questions!,
      };
    } else if (input.includePendingReview) {
      replacementKind = "mixed";
      reviewSnapshotMode = "recalculate";
      const mixed = await prepareMixedAssignmentBatch(
        {
          studentId,
          datasetId: input.datasetId,
          primaryUnitIds: input.primaryUnitIds,
          reviewLevels: input.reviewLevels,
          reviewScope: input.reviewScope,
          totalQuestionCount: input.questionCount,
          title: input.title.trim(),
          englishToKoreanRatio: input.englishToKoreanRatio,
          timeLimitSeconds: input.timeLimitSeconds,
          timingMode: input.timingMode,
          questionTimeLimitSeconds: input.questionTimeLimitSeconds,
          passingScore: input.passingScore,
          retryEnabled: input.retryEnabled,
          retryPassingScore: input.retryPassingScore,
          questionOrderMode: input.questionOrderMode,
          availableUntil: input.availableUntil,
        },
        admin,
        exclusion,
      );
      prepared = {
        ...mixed,
        questionCount: input.questionCount,
        availableFrom: input.availableFrom,
        reviewScope: effectiveReviewScope,
      };
    } else {
      replacementKind = "regular";
      reviewSnapshotMode = "none";
      const regular = await prepareRegularAssignment(
        {
          title: input.title.trim(),
          datasetId: input.datasetId,
          unitIds: input.primaryUnitIds,
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
          studentIds: [studentId],
        },
        admin,
        exclusion,
      );
      prepared = {
        title: regular.title,
        datasetId: regular.datasetId,
        primaryUnitIds: regular.unitIds,
        questionCount: regular.questionCount,
        englishToKoreanRatio: regular.englishToKoreanRatio,
        timeLimitSeconds: regular.timeLimitSeconds,
        passingScore: regular.passingScore,
        retryEnabled: regular.retryEnabled,
        retryPassingScore: regular.retryPassingScore,
        questionOrderMode: regular.questionOrderMode,
        availableFrom: input.availableFrom,
        availableUntil: regular.availableUntil,
        timingMode: regular.timingMode,
        questionTimeLimitSeconds: regular.questionTimeLimitSeconds,
        reviewLevels: [],
        reviewScope: effectiveReviewScope,
        selectedQueueIds: [],
        questions: regular.questions,
      };
    }
  } catch (error) {
    if (error instanceof AssignmentCreationError) {
      throw new AssignmentReplacementError(
        error.reason,
        error.message,
      );
    }
    if (error instanceof MixedAssignmentError) {
      throw new AssignmentReplacementError(
        error.reason === "forbidden"
          ? "forbidden"
          : error.reason === "database"
            ? "database"
            : error.reason === "conflict"
              ? "conflict"
              : "invalid_selection",
        error.message,
      );
    }
    if (error instanceof AssignmentReplacementError) throw error;
    console.error("[assignment-replacement] preparation failed", error);
    throw new AssignmentReplacementError("database");
  }

  return { replacementKind, reviewSnapshotMode, prepared };
}
