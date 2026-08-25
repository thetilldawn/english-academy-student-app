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
import { createTargetedQuizQuestions } from "@/lib/quiz/question-generator";
import {
  type AssignmentQuestionPlan,
  type EditableSourceContext,
  requireEditableSourceContext,
} from "@/lib/services/assignment-edit-source-service";
import {
  AssignmentReplacementError,
} from "@/lib/services/assignment-replacement-errors";
import {
  assertLegacyMixedContentShape,
  assertExactReviewShape,
  canReuseSourceQuestions,
} from "@/lib/services/assignment-replacement-policy";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import {
  calculateAssignmentCapacity,
  MixedAssignmentError,
  prepareMixedAssignmentBatch,
} from "@/lib/services/mixed-assignment-service";
import {
  AssignmentCreationError,
  prepareRegularAssignment,
} from "@/lib/services/regular-assignment-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function prepareExactReviewQuestions(
  source: EditableSourceContext,
  englishToKoreanRatio: 0 | 50 | 100,
  deterministic = false,
): Promise<AssignmentQuestionPlan[]> {
  const supabase = await createServerSupabaseClient();
  const candidates = await loadEligibleVocabularyDataset(
    supabase,
    source.draft.datasetId,
    { includeExamUseProjection: true },
  );
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const targets = source.selectedReviewVocabEntryIds.flatMap(
    (vocabEntryId) => {
      const candidate = candidateById.get(vocabEntryId);
      return candidate ? [candidate] : [];
    },
  );
  if (targets.length !== source.selectedReviewVocabEntryIds.length) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      "오답 시험 대상 중 현재 출제할 수 없는 단어가 있습니다.",
    );
  }

  let drafts;
  try {
    drafts = createTargetedQuizQuestions(
      targets,
      candidates,
      englishToKoreanRatio,
      deterministic ? () => 0.5 : undefined,
    );
  } catch (error) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      error instanceof Error
        ? error.message
        : "오답 시험 문제를 다시 만들 수 없습니다.",
    );
  }
  return drafts.map((question, index) => ({
    vocab_entry_id: question.vocabEntryId,
    base_order_index: index + 1,
    direction: question.direction,
    choice_vocab_entry_ids: question.choiceVocabEntryIds,
  }));
}

export async function calculateStudentAssignmentReplacementCapacity(
  assignmentId: string,
  studentId: string,
  input: AssignmentCapacityInput,
  authenticatedAdmin?: AdminContext,
) {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const source = await requireEditableSourceContext(
    assignmentId,
    studentId,
    admin,
  );
  if (input.studentId !== studentId) {
    throw new AssignmentReplacementError("invalid_selection");
  }
  if (source.draft.purpose === "review") {
    assertExactReviewShape(source, {
      datasetId: input.datasetId,
      primaryUnitIds: input.primaryUnitIds,
      questionCount: source.draft.questionCount,
      includePendingReview: input.includePendingReview,
      reviewLevels: input.reviewLevels,
    });
    const count =
      source.questions &&
      input.englishToKoreanRatio ===
        source.draft.englishToKoreanRatio
        ? source.questions.length
        : (
            await prepareExactReviewQuestions(
              source,
              input.englishToKoreanRatio,
              true,
            )
          ).length;
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
    assertLegacyMixedContentShape(source, input);
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
    availableUntil: string | null;
    timingMode: AssignmentReplacementInput["timingMode"];
    questionTimeLimitSeconds: number | null;
    reviewLevels: (1 | 2)[];
    selectedQueueIds: string[];
    questions: AssignmentQuestionPlan[];
  };
  try {
    const source = await requireEditableSourceContext(
      assignmentId,
      studentId,
      admin,
    );
    if (source.draft.purpose === "review") {
      assertExactReviewShape(source, input);
    }
    assertLegacyMixedContentShape(source, input);

    if (canReuseSourceQuestions(source, input)) {
      const replacementPlan = preservedAssignmentReplacementPlan(
        source.draft.purpose,
        input.includePendingReview,
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
        availableUntil: input.availableUntil,
        timingMode: input.timingMode,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds,
        reviewLevels: input.includePendingReview
          ? [...input.reviewLevels].toSorted()
          : [],
        selectedQueueIds: input.includePendingReview
          ? source.selectedQueueIds
          : [],
        questions: source.questions!,
      };
    } else if (source.draft.purpose === "review") {
      replacementKind = "review";
      reviewSnapshotMode = "preserve";
      prepared = {
        title: input.title.trim(),
        datasetId: input.datasetId,
        primaryUnitIds: [],
        questionCount: input.questionCount,
        englishToKoreanRatio: input.englishToKoreanRatio,
        timeLimitSeconds: input.timeLimitSeconds,
        passingScore: input.passingScore,
        retryEnabled: input.retryEnabled,
        retryPassingScore: input.retryPassingScore,
        questionOrderMode: input.questionOrderMode,
        availableUntil: input.availableUntil,
        timingMode: input.timingMode,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds,
        reviewLevels: [...input.reviewLevels].toSorted(),
        selectedQueueIds: source.selectedQueueIds,
        questions: await prepareExactReviewQuestions(
          source,
          input.englishToKoreanRatio,
        ),
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
        availableUntil: regular.availableUntil,
        timingMode: regular.timingMode,
        questionTimeLimitSeconds: regular.questionTimeLimitSeconds,
        reviewLevels: [],
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
