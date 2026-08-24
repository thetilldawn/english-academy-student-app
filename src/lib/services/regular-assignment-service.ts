import "server-only";

import {
  buildAssignmentQuestionPlan,
  buildExactAssignmentQuestionPlan,
  calculateAssignmentQuestionRange,
  calculateAssignmentSeriesQuestionCapacity,
} from "@/lib/assignment/question-planner";
import {
  quizIndependentTargetDirectionEligibility,
} from "@/lib/quiz/choice-policy";
import {
  quizTargetDirectionConflictKey,
} from "@/lib/quiz/word-identity";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import {
  resolveOrderedUnitSelection,
} from "@/lib/admin/unit-range";
import {
  isAssignmentPersistenceInvariantFailure,
} from "@/lib/admin/assignment-database-error";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  activeReviewIdentities,
  loadActiveReviewAssignments,
} from "@/lib/services/active-review-assignment-service";
import { loadDatasetDisplayLabel } from "@/lib/services/dataset-catalog-service";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { memoizeRequestPreparation } from "@/lib/services/request-preparation-cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export class AssignmentCreationError extends Error {
  constructor(
    public readonly reason:
      | "conflict"
      | "invalid_selection"
      | "database",
    message?: string,
  ) {
    super(
      message ?? (reason === "conflict"
        ? "다른 시험에 이미 포함된 단어가 있습니다. 새로 계산된 최대 문항 수를 확인해 주세요."
        : reason === "invalid_selection"
          ? "현재 출제 가능한 범위와 문항 수를 다시 확인해 주세요."
          : "시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요."),
    );
    this.name = "AssignmentCreationError";
  }
}

export type RegularAssignmentInput = {
  title: string;
  datasetId: string;
  unitIds: string[];
  questionCount: number;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  timingMode?: TimingMode;
  questionTimeLimitSeconds?: number | null;
  passingScore: number;
  retryEnabled: boolean;
  retryPassingScore: number | null;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
  studentIds: string[];
  targetSelectionMode?: "source_order" | "random";
  randomSeed?: string;
  excludedTargetIds?: readonly number[];
  requiredTargetIds?: readonly number[];
  exactTargetIds?: readonly number[];
  exactTargetDirections?: readonly (
    | "english_to_korean"
    | "korean_to_english"
  )[];
};

export type PreparedRegularAssignment = {
  title: string;
  datasetId: string;
  unitIds: string[];
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
  studentIds: string[];
  questions: {
    vocab_entry_id: number;
    base_order_index: number;
    direction: "english_to_korean" | "korean_to_english";
    choice_vocab_entry_ids: number[];
  }[];
};

type RegularAssignmentExclusion = {
  assignmentId: string;
  studentId: string;
};

async function loadRegularDatasetPreparation(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  datasetId: string,
) {
  const [datasetResult, unitResult, allCandidates] = await Promise.all([
    supabase
      .from("vocab_datasets")
      .select("id, title, edition")
      .eq("id", datasetId)
      .eq("status", "ready")
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("vocab_units")
      .select("id, unit_label, sort_index")
      .eq("dataset_id", datasetId)
      .order("sort_index"),
    loadEligibleVocabularyDataset(supabase, datasetId, {
      includeExamUseProjection: true,
    }),
  ]);
  const datasetLabel =
    datasetResult.data && !datasetResult.error
      ? await loadDatasetDisplayLabel(supabase, datasetResult.data)
      : null;
  return { datasetResult, unitResult, allCandidates, datasetLabel };
}

function regularPreparationCacheKey(parts: readonly unknown[]) {
  return JSON.stringify(parts);
}

export type RegularAssignmentPreparationCache = {
  supabase: Promise<
    Awaited<ReturnType<typeof createServerSupabaseClient>>
  >;
  datasets: Map<
    string,
    Promise<Awaited<ReturnType<typeof loadRegularDatasetPreparation>>>
  >;
  activeAssignments: Map<
    string,
    Promise<Awaited<ReturnType<typeof loadActiveReviewAssignments>>>
  >;
};

/** Reuses preparation reads only for the lifetime of one save request. */
export function createRegularAssignmentPreparationCache(): RegularAssignmentPreparationCache {
  return {
    supabase: createServerSupabaseClient(),
    datasets: new Map(),
    activeAssignments: new Map(),
  };
}

export async function prepareRegularAssignment(
  input: RegularAssignmentInput,
  authenticatedAdmin?: AdminContext,
  exclusion?: RegularAssignmentExclusion,
  cache?: RegularAssignmentPreparationCache,
): Promise<PreparedRegularAssignment> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const preparationCache =
    cache ?? createRegularAssignmentPreparationCache();
  const supabase = await preparationCache.supabase;
  const datasetPreparation = await memoizeRequestPreparation(
    preparationCache.datasets,
    input.datasetId,
    () => loadRegularDatasetPreparation(supabase, input.datasetId),
  );
  const {
    datasetResult: { data: dataset, error: datasetError },
    unitResult: { data: unitData, error: unitError },
    allCandidates,
    datasetLabel,
  } = datasetPreparation;
  const requestedUnitIds = new Set(input.unitIds);
  const selectedUnitData = (unitData ?? []).filter((unit) =>
    requestedUnitIds.has(unit.id),
  );

  if (
    datasetError ||
    unitError ||
    !dataset ||
    !unitData ||
    !datasetLabel ||
    selectedUnitData.length !== input.unitIds.length
  ) {
    throw new Error("선택한 단어장과 DAY를 사용할 수 없습니다.");
  }

  let orderedUnits: typeof selectedUnitData;
  try {
    orderedUnits = resolveOrderedUnitSelection(
      selectedUnitData.map((unit) => ({
        ...unit,
        sortIndex: unit.sort_index,
      })),
      input.unitIds,
    );
  } catch {
    throw new AssignmentCreationError(
      "invalid_selection",
      "선택한 범위의 순서를 확인해 주세요.",
    );
  }
  const orderedUnitIds = orderedUnits.map((unit) => unit.id);
  const activeAssignmentKey = regularPreparationCacheKey([
    [...input.studentIds].sort(),
    input.datasetId,
    exclusion?.assignmentId ?? null,
    exclusion?.studentId ?? null,
  ]);
  const activeAssignments = await memoizeRequestPreparation(
    preparationCache.activeAssignments,
    activeAssignmentKey,
    () =>
      loadActiveReviewAssignments(
        supabase,
        input.studentIds,
        input.datasetId,
        exclusion,
      ),
  );
  const unitIdSet = new Set(orderedUnitIds);
  const excludedTargetIds = new Set(input.excludedTargetIds ?? []);
  const choiceCandidates = allCandidates.filter(
    (candidate) =>
      unitIdSet.has(candidate.unitId) &&
      !activeReviewIdentities(
        candidate.id,
        candidate.canonicalLexemeId,
        candidate.headwordNormalized,
        candidate.canonicalDictionaryId,
      ).some((identity) =>
        activeAssignments.reviewIdentities.has(identity),
      ),
  );
  const primaryCandidates = choiceCandidates.filter(
    (candidate) => !excludedTargetIds.has(candidate.id),
  );
  const requiredTargetIds = input.requiredTargetIds ?? [];
  const requiredTargetIdSet = new Set(requiredTargetIds);
  const exactTargetIds = input.exactTargetIds ?? [];
  const exactTargetIdSet = new Set(exactTargetIds);
  const exactTargetDirections = input.exactTargetDirections ?? [];
  const choiceCandidateById = new Map(
    choiceCandidates.map((candidate) => [candidate.id, candidate]),
  );
  if (
    (requiredTargetIds.length > 0 && exactTargetIds.length > 0) ||
    requiredTargetIdSet.size !== requiredTargetIds.length ||
    exactTargetIdSet.size !== exactTargetIds.length ||
    (exactTargetDirections.length > 0 &&
      exactTargetDirections.length !== exactTargetIds.length) ||
    requiredTargetIds.some(
      (targetId) =>
        excludedTargetIds.has(targetId) ||
        !choiceCandidateById.has(targetId),
    ) ||
    exactTargetIds.some(
      (targetId) =>
        excludedTargetIds.has(targetId) ||
        !choiceCandidateById.has(targetId),
    ) ||
    (exactTargetIds.length > 0 && exactTargetIds.length !== input.questionCount)
  ) {
    throw new AssignmentCreationError(
      "invalid_selection",
      "이어 낼 출제 대상이 현재 단어장 범위와 일치하지 않습니다.",
    );
  }
  const requiredTargets = requiredTargetIds.map(
    (targetId) => choiceCandidateById.get(targetId)!,
  );
  const exactTargets = exactTargetIds.map(
    (targetId) => choiceCandidateById.get(targetId)!,
  );
  const selectablePrimaryCandidates = primaryCandidates.filter(
    (candidate) => !requiredTargetIdSet.has(candidate.id),
  );
  const sourceOrderByCandidateId = new Map(
    allCandidates.map((candidate) => [
      candidate.id,
      candidate.sourceRow,
    ]),
  );
  const unitIdByCandidateId = new Map(
    allCandidates.map((candidate) => [candidate.id, candidate.unitId]),
  );
  const unitPositionById = new Map(
    orderedUnitIds.map((unitId, index) => [unitId, index]),
  );
  let questionDrafts: ReturnType<typeof buildAssignmentQuestionPlan>;
  try {
    questionDrafts = exactTargets.length > 0
      ? buildExactAssignmentQuestionPlan({
          targets: exactTargets,
          allCandidates: choiceCandidates,
          englishToKoreanRatio: input.englishToKoreanRatio,
          randomSeed: input.randomSeed ?? "exact-assignment",
          ...(exactTargetDirections.length > 0
            ? { targetDirections: exactTargetDirections }
            : {}),
        })
      : buildAssignmentQuestionPlan({
          requiredTargets,
          primaryCandidates: selectablePrimaryCandidates,
          allCandidates: choiceCandidates,
          questionCount: input.questionCount,
          englishToKoreanRatio: input.englishToKoreanRatio,
          targetSelectionMode: input.targetSelectionMode,
          randomSeed: input.randomSeed,
        });
  } catch (error) {
    throw new AssignmentCreationError(
      "invalid_selection",
      error instanceof Error
        ? error.message
        : `선택한 범위에서는 ${input.questionCount}문항을 만들 수 없습니다. 문항 수를 줄이거나 출제 방식을 바꿔주세요.`,
    );
  }
  questionDrafts.sort(
    (left, right) =>
      (unitPositionById.get(
        unitIdByCandidateId.get(left.vocabEntryId) ?? "",
      ) ?? Number.MAX_SAFE_INTEGER) -
        (unitPositionById.get(
          unitIdByCandidateId.get(right.vocabEntryId) ?? "",
        ) ?? Number.MAX_SAFE_INTEGER) ||
      (sourceOrderByCandidateId.get(left.vocabEntryId) ?? 0) -
        (sourceOrderByCandidateId.get(right.vocabEntryId) ?? 0),
  );
  const isContiguousSelection = orderedUnits.every(
    (unit, index) => index === 0 ||
      Math.abs(unit.sort_index - orderedUnits[index - 1]!.sort_index) === 1,
  );
  const unitRangeLabel = orderedUnits.length === 1
    ? orderedUnits[0].unit_label
    : isContiguousSelection
      ? `${orderedUnits[0].unit_label}~${orderedUnits.at(-1)?.unit_label}`
      : `${orderedUnits[0].unit_label} 외 ${orderedUnits.length - 1}개`;
  const generatedTitle = [datasetLabel, unitRangeLabel].join(" · ");

  return {
    title: input.title || generatedTitle,
    datasetId: input.datasetId,
    unitIds: orderedUnitIds,
    questionCount: input.questionCount,
    englishToKoreanRatio: input.englishToKoreanRatio,
    timeLimitSeconds: input.timeLimitSeconds,
    timingMode: input.timingMode ?? "total",
    questionTimeLimitSeconds:
      input.timingMode === "per_question"
        ? (input.questionTimeLimitSeconds ?? null)
        : null,
    passingScore: input.passingScore,
    retryEnabled: input.retryEnabled,
    retryPassingScore: input.retryPassingScore,
    questionOrderMode: input.questionOrderMode,
    availableUntil: input.availableUntil,
    studentIds: input.studentIds,
    questions: questionDrafts.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      base_order_index: index + 1,
      direction: question.direction,
      choice_vocab_entry_ids: question.choiceVocabEntryIds,
    })),
  };
}

export async function loadRegularAssignmentSeriesCandidates(
  input: {
    datasetId: string;
    unitIds: readonly string[];
    studentIds: readonly string[];
  },
  authenticatedAdmin?: AdminContext,
  cache?: RegularAssignmentPreparationCache,
) {
  if (!authenticatedAdmin) await requireAdmin();
  const preparationCache = cache ?? createRegularAssignmentPreparationCache();
  const supabase = await preparationCache.supabase;
  const preparation = await memoizeRequestPreparation(
    preparationCache.datasets,
    input.datasetId,
    () => loadRegularDatasetPreparation(supabase, input.datasetId),
  );
  const requestedUnitIds = new Set(input.unitIds);
  const selectedUnitData = (preparation.unitResult.data ?? []).filter((unit) =>
    requestedUnitIds.has(unit.id)
  );
  if (
    preparation.datasetResult.error ||
    preparation.unitResult.error ||
    !preparation.datasetResult.data ||
    !preparation.unitResult.data ||
    selectedUnitData.length !== input.unitIds.length
  ) {
    throw new AssignmentCreationError(
      "invalid_selection",
      "선택한 단어장과 출제 대상을 사용할 수 없습니다.",
    );
  }
  const activeAssignmentKey = regularPreparationCacheKey([
    [...input.studentIds].sort(),
    input.datasetId,
    null,
    null,
  ]);
  const activeAssignments = await memoizeRequestPreparation(
    preparationCache.activeAssignments,
    activeAssignmentKey,
    () =>
      loadActiveReviewAssignments(
        supabase,
        [...input.studentIds],
        input.datasetId,
      ),
  );
  let orderedUnits: typeof selectedUnitData;
  try {
    orderedUnits = resolveOrderedUnitSelection(
      selectedUnitData.map((unit) => ({
        ...unit,
        sortIndex: unit.sort_index,
      })),
      [...input.unitIds],
    );
  } catch {
    throw new AssignmentCreationError(
      "invalid_selection",
      "선택한 범위의 순서를 확인해 주세요.",
    );
  }
  const orderedUnitIds = orderedUnits.map((unit) => unit.id);
  const unitIdSet = new Set(orderedUnitIds);
  const choiceCandidates = preparation.allCandidates.filter(
    (candidate) =>
      unitIdSet.has(candidate.unitId) &&
      !activeReviewIdentities(
        candidate.id,
        candidate.canonicalLexemeId,
        candidate.headwordNormalized,
        candidate.canonicalDictionaryId,
      ).some((identity) =>
        activeAssignments.reviewIdentities.has(identity)
      ),
  );
  const unitPositionById = new Map(
    orderedUnitIds.map((unitId, index) => [unitId, index]),
  );
  const orderedCandidates = [...choiceCandidates].sort(
    (left, right) =>
      (unitPositionById.get(left.unitId) ?? Number.MAX_SAFE_INTEGER) -
        (unitPositionById.get(right.unitId) ?? Number.MAX_SAFE_INTEGER) ||
      left.sourceRow - right.sourceRow,
  );
  const candidateById = new Map(
    orderedCandidates.map((candidate) => [candidate.id, candidate]),
  );
  return quizIndependentTargetDirectionEligibility(
    orderedCandidates,
    choiceCandidates,
  )
    .filter((candidate) => candidate.eligibleDirections.length > 0)
    .map((candidate) => {
      const entry = candidateById.get(candidate.id)!;
      return {
        ...candidate,
        conflictKeys: Object.fromEntries(
          candidate.eligibleDirections.map((direction) => [
            direction,
            quizTargetDirectionConflictKey(entry, direction),
          ]),
        ),
      };
    });
}

/** Capacity for a normal range assignment without reading the wrong-word queue. */
export async function calculateRegularAssignmentCapacity(
  input: {
    datasetId: string;
    unitIds: readonly string[];
    studentIds: readonly string[];
    englishToKoreanRatio: 0 | 50 | 100;
  },
  authenticatedAdmin?: AdminContext,
  cache?: RegularAssignmentPreparationCache,
) {
  if (!authenticatedAdmin) await requireAdmin();
  const preparationCache = cache ?? createRegularAssignmentPreparationCache();
  const supabase = await preparationCache.supabase;
  const preparation = await memoizeRequestPreparation(
    preparationCache.datasets,
    input.datasetId,
    () => loadRegularDatasetPreparation(supabase, input.datasetId),
  );
  const requestedUnitIds = new Set(input.unitIds);
  const selectedUnitData = (preparation.unitResult.data ?? []).filter((unit) =>
    requestedUnitIds.has(unit.id)
  );
  if (
    preparation.datasetResult.error ||
    preparation.unitResult.error ||
    !preparation.datasetResult.data ||
    !preparation.unitResult.data ||
    selectedUnitData.length !== input.unitIds.length
  ) {
    throw new AssignmentCreationError(
      "invalid_selection",
      "선택한 단어장과 출제 대상을 사용할 수 없습니다.",
    );
  }
  const activeAssignmentKey = regularPreparationCacheKey([
    [...input.studentIds].sort(),
    input.datasetId,
    null,
    null,
  ]);
  const activeAssignments = await memoizeRequestPreparation(
    preparationCache.activeAssignments,
    activeAssignmentKey,
    () =>
      loadActiveReviewAssignments(
        supabase,
        [...input.studentIds],
        input.datasetId,
      ),
  );
  const choiceCandidates = preparation.allCandidates.filter(
    (candidate) =>
      requestedUnitIds.has(candidate.unitId) &&
      !activeReviewIdentities(
        candidate.id,
        candidate.canonicalLexemeId,
        candidate.headwordNormalized,
        candidate.canonicalDictionaryId,
      ).some((identity) =>
        activeAssignments.reviewIdentities.has(identity)
      ),
  );
  const range = calculateAssignmentQuestionRange({
    requiredTargets: [],
    primaryCandidates: choiceCandidates,
    allCandidates: choiceCandidates,
    englishToKoreanRatio: input.englishToKoreanRatio,
  });
  return {
    ...range,
    recommendedQuestionCount: range.maximumQuestionCount,
    seriesMaximumQuestionCount: calculateAssignmentSeriesQuestionCapacity({
      requiredTargets: [],
      primaryCandidates: choiceCandidates,
      allCandidates: choiceCandidates,
      englishToKoreanRatio: input.englishToKoreanRatio,
    }),
  };
}

export async function createRegularAssignment(
  input: RegularAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const preparationCache = createRegularAssignmentPreparationCache();
  const prepared = await prepareRegularAssignment(
    input,
    admin,
    undefined,
    preparationCache,
  );
  const supabase = await preparationCache.supabase;
  const { data, error } = await supabase.rpc(
    "create_assignment_with_delivery_v7",
    {
      p_title: prepared.title,
      p_dataset_id: prepared.datasetId,
      p_unit_ids: prepared.unitIds,
      p_question_count: prepared.questionCount,
      p_english_to_korean_ratio: prepared.englishToKoreanRatio,
      p_time_limit_seconds: prepared.timeLimitSeconds,
      p_passing_score: prepared.passingScore,
      p_retry_enabled: prepared.retryEnabled,
      p_retry_passing_score: prepared.retryPassingScore,
      p_question_order_mode: prepared.questionOrderMode,
      p_available_until: prepared.availableUntil,
      p_student_ids: prepared.studentIds,
      p_timing_mode: prepared.timingMode,
      p_question_time_limit_seconds:
        prepared.questionTimeLimitSeconds,
      p_questions: prepared.questions,
    },
  );

  if (error || typeof data !== "string") {
    console.error("[regular-assignment] database operation failed", {
      code: error?.code ?? "missing_result",
      message: error?.message ?? "assignment id was not returned",
      hint: error?.hint ?? null,
    });
    const reason = isAssignmentPersistenceInvariantFailure(error ?? {})
      ? "database"
      : error?.code === "40001"
        ? "conflict"
        : ["22023", "23503", "23505"].includes(error?.code ?? "")
          ? "invalid_selection"
          : "database";
    throw new AssignmentCreationError(reason);
  }

  return data;
}
