import "server-only";

import { z } from "zod";

import {
  excludePendingReviewCandidates,
  mixedAssignmentDatabaseErrorReason,
  mixedAssignmentGeneratedTitle,
  mixedAssignmentPrimaryUnitIds,
  type MixedAssignmentFailureReason,
  type MixedAssignmentUnit,
  type PendingReviewIdentity,
} from "@/lib/admin/mixed-assignment";
import {
  countReviewLevels,
  resolveReviewCandidate,
} from "@/lib/admin/review-candidate";
import type { TimingMode } from "@/lib/admin/assignment-settings";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";
import {
  quizVocabularyIdentity,
} from "@/lib/quiz/engine";
import {
  buildAssignmentQuestionPlan,
  calculateAssignmentQuestionRange,
  calculateAssignmentSeriesQuestionCapacity,
} from "@/lib/assignment/question-planner";
import {
  activeReviewIdentities,
  loadActiveReviewAssignments,
} from "@/lib/services/active-review-assignment-service";
import { resolveOrderedUnitSelection } from "@/lib/admin/unit-range";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { loadDatasetDisplayLabel } from "@/lib/services/dataset-catalog-service";
import { memoizeRequestPreparation } from "@/lib/services/request-preparation-cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AssignmentCapacityInput } from "@/lib/admin/assignment-replacement-request";
import type { MixedAssignmentInput } from "@/lib/admin/mixed-assignment-request";

const REVIEW_QUEUE_PAGE_SIZE = 1000;
const MAX_ASSIGNMENT_TITLE_LENGTH = 160;
const MAX_MIXED_REVIEW_WORDS = 500;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type ReviewQueueRow = {
  id: string;
  vocab_entry_id: number;
  canonical_lexeme_id_snapshot: string | null;
  canonical_dictionary_id_snapshot: string | null;
  reason_level: 1 | 2;
  queued_at: string;
  reserved_review_draft_id: string | null;
};

type UnitRow = {
  id: string;
  unit_label: string;
  sort_index: number;
};

type DatasetRow = {
  id: string;
  title: string;
  edition: string | null;
  status: string;
  is_active: boolean;
};

type AssignmentExclusion = {
  assignmentId: string;
  studentId: string;
};

async function loadStudentForPreparation(
  supabase: ServerSupabaseClient,
  studentId: string,
) {
  return supabase
    .from("students")
    .select("id, status")
    .eq("id", studentId)
    .maybeSingle();
}

async function loadDatasetForPreparation(
  supabase: ServerSupabaseClient,
  datasetId: string,
) {
  const [datasetResult, unitResult, allCandidates] = await Promise.all([
    supabase
      .from("vocab_datasets")
      .select("id, title, edition, status, is_active")
      .eq("id", datasetId)
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
  return { datasetResult, unitResult, allCandidates };
}

function preparationCacheKey(parts: readonly unknown[]) {
  return JSON.stringify(parts);
}

export type MixedAssignmentPreparationCache = {
  supabase: Promise<ServerSupabaseClient>;
  students: Map<
    string,
    Promise<Awaited<ReturnType<typeof loadStudentForPreparation>>>
  >;
  datasets: Map<
    string,
    Promise<Awaited<ReturnType<typeof loadDatasetForPreparation>>>
  >;
  reviewQueues: Map<string, Promise<ReviewQueueRow[]>>;
  datasetLabels: Map<string, Promise<string>>;
  activeAssignments: Map<
    string,
    Promise<Awaited<ReturnType<typeof loadActiveReviewAssignments>>>
  >;
};

/**
 * Reuses immutable preparation reads only inside one preview/save request.
 * A new request always creates a fresh cache and therefore revalidates data.
 */
export function createMixedAssignmentPreparationCache(): MixedAssignmentPreparationCache {
  return {
    supabase: createServerSupabaseClient(),
    students: new Map(),
    datasets: new Map(),
    reviewQueues: new Map(),
    datasetLabels: new Map(),
    activeAssignments: new Map(),
  };
}

export type AssignmentCapacity = {
  eligibleBeforeActiveAssignment: number;
  activeAssignmentExcluded: number;
  questionPlanExcluded: number;
  unitEligible: number;
  wrongEligible: number;
  wrongLevel1Eligible: number;
  wrongLevel2Eligible: number;
  overlap: number;
  alreadyAssigned: number;
  maximumQuestionCount: number;
  recommendedQuestionCount: number;
  minimumQuestionCount: number;
};

type PreparedAssignment = {
  supabase: ServerSupabaseClient;
  dataset: DatasetRow;
  preparationCache: MixedAssignmentPreparationCache;
  primaryUnits: MixedAssignmentUnit[];
  primaryCandidates: EligibleVocabularyEntry[];
  allCandidates: EligibleVocabularyEntry[];
  selectedQueueRows: ReviewQueueRow[];
  reviewTargets: EligibleVocabularyEntry[];
  capacity: AssignmentCapacity;
};

export class MixedAssignmentError extends Error {
  constructor(
    public readonly reason: MixedAssignmentFailureReason,
    message = "틀렸던 단어를 포함한 시험을 배정하지 못했습니다.",
  ) {
    super(message);
    this.name = "MixedAssignmentError";
  }
}

function entryIdentity(entry: EligibleVocabularyEntry) {
  return quizVocabularyIdentity(entry);
}

function queueIdentities(
  queue: ReviewQueueRow,
  candidate?: EligibleVocabularyEntry,
) {
  if (candidate) {
    return activeReviewIdentities(
      candidate.id,
      candidate.canonicalLexemeId,
      candidate.headwordNormalized,
      candidate.canonicalDictionaryId,
    );
  }
  return activeReviewIdentities(
    queue.vocab_entry_id,
    queue.canonical_lexeme_id_snapshot,
    undefined,
    queue.canonical_dictionary_id_snapshot,
  );
}

function isActiveQueue(
  identities: ReadonlySet<string>,
  queue: ReviewQueueRow,
  candidate?: EligibleVocabularyEntry,
) {
  return queueIdentities(queue, candidate).some((identity) =>
    identities.has(identity),
  );
}

function uniqueTargetCount(
  entries: readonly EligibleVocabularyEntry[],
) {
  return new Set(entries.map((entry) => entry.id)).size;
}

async function loadReviewQueueRows(
  supabase: ServerSupabaseClient,
  studentId: string,
  datasetId: string,
) {
  const rows: ReviewQueueRow[] = [];
  for (
    let offset = 0;
    ;
    offset += REVIEW_QUEUE_PAGE_SIZE
  ) {
    const { data, error } = await supabase
      .from("student_vocab_review_queue")
      .select(
        "id, vocab_entry_id, canonical_lexeme_id_snapshot, canonical_dictionary_id_snapshot, reason_level, queued_at, reserved_review_draft_id",
      )
      .eq("student_id", studentId)
      .eq("dataset_id", datasetId)
      .eq("status", "pending")
      .is("reserved_review_draft_id", null)
      .order("reason_level", { ascending: false })
      .order("queued_at")
      .order("id")
      .range(offset, offset + REVIEW_QUEUE_PAGE_SIZE - 1);
    if (error) {
      throw new MixedAssignmentError("database");
    }
    rows.push(...((data ?? []) as ReviewQueueRow[]));
    if (!data || data.length < REVIEW_QUEUE_PAGE_SIZE) break;
  }
  return rows;
}

async function prepareAssignment(
  input: AssignmentCapacityInput,
  authenticatedAdmin?: AdminContext,
  exclusion?: AssignmentExclusion,
  cache?: MixedAssignmentPreparationCache,
): Promise<PreparedAssignment> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }

  const preparationCache =
    cache ?? createMixedAssignmentPreparationCache();
  const supabase = await preparationCache.supabase;
  const reviewLevels = [...input.reviewLevels].sort(
    (left, right) => left - right,
  );
  const reviewScope = input.reviewScope ?? "dataset";
  const studentKey = input.studentId;
  const datasetKey = input.datasetId;
  const studentDatasetKey = preparationCacheKey([
    input.studentId,
    input.datasetId,
  ]);
  const activeAssignmentKey = preparationCacheKey([
    input.studentId,
    input.datasetId,
    exclusion?.assignmentId ?? null,
    exclusion?.studentId ?? null,
  ]);
  const [studentResult, datasetPreparation, queueRows, activeReviewAssignments] =
    await Promise.all([
      memoizeRequestPreparation(
        preparationCache.students,
        studentKey,
        () => loadStudentForPreparation(supabase, input.studentId),
      ),
      memoizeRequestPreparation(
        preparationCache.datasets,
        datasetKey,
        () => loadDatasetForPreparation(supabase, input.datasetId),
      ),
      memoizeRequestPreparation(
        preparationCache.reviewQueues,
        studentDatasetKey,
        () => loadReviewQueueRows(supabase, input.studentId, input.datasetId),
      ),
      memoizeRequestPreparation(
        preparationCache.activeAssignments,
        activeAssignmentKey,
        () =>
          loadActiveReviewAssignments(
            supabase,
            [input.studentId],
            input.datasetId,
            exclusion,
          ),
      ),
    ]);
  const { data: student, error: studentError } = studentResult;
  const {
    datasetResult: { data: datasetData, error: datasetError },
    unitResult: { data: unitData, error: unitError },
    allCandidates,
  } = datasetPreparation;

  if (studentError || datasetError || unitError) {
    throw new MixedAssignmentError("database");
  }
  const dataset = datasetData as DatasetRow | null;
  if (
    !student ||
    student.status !== "active" ||
    !dataset ||
    dataset.status !== "ready" ||
    !dataset.is_active
  ) {
    throw new MixedAssignmentError("unavailable");
  }

  let primaryUnits: MixedAssignmentUnit[];
  try {
    const availableUnits = ((unitData ?? []) as UnitRow[]).map((unit) => ({
        id: unit.id,
        unitLabel: unit.unit_label,
        sortIndex: unit.sort_index,
      }));
    primaryUnits = resolveOrderedUnitSelection(
      availableUnits,
      input.primaryUnitIds,
    );
  } catch {
    throw new MixedAssignmentError("invalid_selection");
  }

  const primaryUnitIdSet = new Set(
    primaryUnits.map((unit) => unit.id),
  );
  const candidateByQueueId = new Map<
    string,
    EligibleVocabularyEntry
  >();
  const scopedQueueRows = queueRows.filter((row) => {
    const candidate = resolveReviewCandidate(
      allCandidates,
      {
        vocabEntryId: row.vocab_entry_id,
        canonicalDictionaryId:
          row.canonical_dictionary_id_snapshot,
        canonicalLexemeId: row.canonical_lexeme_id_snapshot,
      },
      reviewScope,
      primaryUnitIdSet,
    );
    if (candidate) candidateByQueueId.set(row.id, candidate);
    return candidate !== undefined;
  });
  const availableQueueRows = scopedQueueRows.filter((row) => {
    const candidate = candidateByQueueId.get(row.id);
    return (
      !activeReviewAssignments.queueIds.has(row.id) &&
      !isActiveQueue(activeReviewAssignments.identities, row, candidate)
    );
  });
  const selectedByIdentity = new Map<string, ReviewQueueRow>();
  for (const row of availableQueueRows) {
    const identity = quizVocabularyIdentity(
      candidateByQueueId.get(row.id)!,
    );
    if (!selectedByIdentity.has(identity)) {
      selectedByIdentity.set(identity, row);
    }
  }
  const availableUniqueQueueRows = [...selectedByIdentity.values()];
  const eligibleReviewRows = availableUniqueQueueRows
    .filter((row) => reviewLevels.includes(row.reason_level))
    .slice(0, MAX_MIXED_REVIEW_WORDS);
  const eligibleReviewTargets = eligibleReviewRows.flatMap((queue) => {
    const candidate = candidateByQueueId.get(queue.id);
    return candidate ? [candidate] : [];
  });
  if (eligibleReviewTargets.length !== eligibleReviewRows.length) {
    throw new MixedAssignmentError(
      "invalid_selection",
      "틀렸던 단어 중 현재 출제할 수 없는 항목이 있습니다.",
    );
  }
  if (
    eligibleReviewRows.some((queue, index) => {
      const candidate = eligibleReviewTargets[index];
      return (
        queue.canonical_lexeme_id_snapshot !== null &&
        queue.canonical_lexeme_id_snapshot !== candidate?.canonicalLexemeId
      ) || (
        queue.canonical_dictionary_id_snapshot !== null &&
        queue.canonical_dictionary_id_snapshot !==
          candidate?.canonicalDictionaryId
      );
    })
  ) {
    throw new MixedAssignmentError("conflict");
  }

  const selectedQueueRows = input.includePendingReview
    ? eligibleReviewRows
    : [];
  const reviewTargets = input.includePendingReview
    ? eligibleReviewTargets
    : [];
  const reviewLevelCounts = countReviewLevels(
    eligibleReviewRows.map((row) => row.reason_level),
  );

  const candidatesInSelectedUnits = allCandidates.filter(
    (candidate) => primaryUnitIdSet.has(candidate.unitId),
  );
  const unitCandidates = candidatesInSelectedUnits.filter(
    (candidate) =>
      !activeReviewIdentities(
        candidate.id,
        candidate.canonicalLexemeId,
        candidate.headwordNormalized,
        candidate.canonicalDictionaryId,
      ).some((identity) =>
        activeReviewAssignments.reviewIdentities.has(identity),
      ),
  );
  const selectedReviewIdentities: PendingReviewIdentity[] =
    selectedQueueRows.map((_queue, index) => ({
      vocabEntryId: reviewTargets[index].id,
      canonicalKey: reviewTargets[index]?.canonicalKey ?? null,
      headword: reviewTargets[index]?.headword,
    }));
  const primaryCandidates = input.includePendingReview
    ? excludePendingReviewCandidates(
        unitCandidates,
        selectedReviewIdentities,
      )
    : unitCandidates;
  const unitIdentitySet = new Set(unitCandidates.map(entryIdentity));
  const overlap = reviewTargets.filter((target) =>
    unitIdentitySet.has(entryIdentity(target)),
  ).length;
  const questionRange = input.includePendingReview
    ? calculateAssignmentQuestionRange({
        requiredTargets: reviewTargets,
        primaryCandidates,
        allCandidates,
        englishToKoreanRatio: input.englishToKoreanRatio,
      })
    : calculateAssignmentQuestionRange({
        primaryCandidates,
        allCandidates: primaryCandidates,
        englishToKoreanRatio: input.englishToKoreanRatio,
      });
  const {
    maximumQuestionCount,
    minimumQuestionCount,
  } = questionRange;
  const eligibleBeforeActiveAssignment = uniqueTargetCount(
    candidatesInSelectedUnits,
  );
  const unitEligible = uniqueTargetCount(unitCandidates);
  const questionPoolCount = input.includePendingReview
    ? reviewTargets.length + uniqueTargetCount(primaryCandidates)
    : unitEligible;
  const capacity: AssignmentCapacity = {
    eligibleBeforeActiveAssignment,
    activeAssignmentExcluded: Math.max(
      0,
      eligibleBeforeActiveAssignment - unitEligible,
    ),
    questionPlanExcluded: Math.max(
      0,
      questionPoolCount - maximumQuestionCount,
    ),
    unitEligible,
    wrongEligible: eligibleReviewTargets.length,
    wrongLevel1Eligible: reviewLevelCounts.level1,
    wrongLevel2Eligible: reviewLevelCounts.level2,
    overlap,
    alreadyAssigned: scopedQueueRows.filter((row) =>
      activeReviewAssignments.queueIds.has(row.id) ||
      isActiveQueue(
        activeReviewAssignments.identities,
        row,
        candidateByQueueId.get(row.id),
      ),
    ).length,
    maximumQuestionCount,
    recommendedQuestionCount: maximumQuestionCount,
    minimumQuestionCount,
  };

  return {
    supabase,
    dataset,
    preparationCache,
    primaryUnits,
    primaryCandidates,
    allCandidates,
    selectedQueueRows,
    reviewTargets,
    capacity,
  };
}

export async function calculateAssignmentCapacity(
  input: AssignmentCapacityInput,
  authenticatedAdmin?: AdminContext,
  exclusion?: AssignmentExclusion,
  cache?: MixedAssignmentPreparationCache,
) {
  const prepared = await prepareAssignment(
    input,
    authenticatedAdmin,
    exclusion,
    cache,
  );
  return prepared.capacity;
}

export async function calculateAssignmentSeriesCapacity(
  input: AssignmentCapacityInput,
  authenticatedAdmin?: AdminContext,
  exclusion?: AssignmentExclusion,
  cache?: MixedAssignmentPreparationCache,
) {
  const prepared = await prepareAssignment(
    input,
    authenticatedAdmin,
    exclusion,
    cache,
  );
  return {
    ...prepared.capacity,
    seriesMaximumQuestionCount: calculateAssignmentSeriesQuestionCapacity({
      requiredTargets: prepared.reviewTargets,
      primaryCandidates: prepared.primaryCandidates,
      allCandidates: input.includePendingReview
        ? prepared.allCandidates
        : prepared.primaryCandidates,
      englishToKoreanRatio: input.englishToKoreanRatio,
    }),
  };
}

export type PreparedMixedAssignmentBatch = {
  studentId: string;
  datasetId: string;
  reviewLevels: (1 | 2)[];
  reviewScope: "dataset" | "selection";
  selectedQueueIds: string[];
  title: string;
  primaryUnitIds: string[];
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  passingScore: number;
  retryEnabled: boolean;
  retryPassingScore: number | null;
  questionOrderMode: MixedAssignmentInput["questionOrderMode"];
  availableUntil: string | null;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  questions: {
    vocab_entry_id: number;
    base_order_index: number;
    direction: "english_to_korean" | "korean_to_english";
    choice_vocab_entry_ids: number[];
  }[];
};

async function preparePendingReviewAssignmentBatch(
  input: MixedAssignmentInput,
  authenticatedAdmin?: AdminContext,
  exclusion?: AssignmentExclusion,
  cache?: MixedAssignmentPreparationCache,
): Promise<PreparedMixedAssignmentBatch> {
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= Date.now()
  ) {
    throw new MixedAssignmentError(
      "invalid_selection",
      "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
    );
  }

  const prepared = await prepareAssignment(
    {
      studentId: input.studentId,
      datasetId: input.datasetId,
      primaryUnitIds: input.primaryUnitIds,
      includePendingReview: true,
      reviewLevels: input.reviewLevels,
      reviewScope: input.reviewScope,
      englishToKoreanRatio: input.englishToKoreanRatio,
    },
    authenticatedAdmin,
    exclusion,
    cache,
  );
  const { capacity } = prepared;
  if (prepared.selectedQueueRows.length === 0) {
    throw new MixedAssignmentError(
      "unavailable",
      capacity.alreadyAssigned > 0
        ? "선택한 틀렸던 단어는 이미 다른 시험에 배정되어 있습니다."
        : "선택한 단계에 추가할 틀렸던 단어가 없습니다.",
    );
  }
  if (
    input.totalQuestionCount < capacity.minimumQuestionCount ||
    input.totalQuestionCount > capacity.maximumQuestionCount
  ) {
    throw new MixedAssignmentError(
      "invalid_selection",
      capacity.maximumQuestionCount >= capacity.minimumQuestionCount
        ? `현재 조건에서는 ${capacity.minimumQuestionCount}~${capacity.maximumQuestionCount}문항으로 배정할 수 있습니다.`
        : "선택한 단어장 범위는 아직 시험 배정 준비가 끝나지 않았습니다.",
    );
  }

  let questionDrafts;
  try {
    questionDrafts = buildAssignmentQuestionPlan({
      requiredTargets: prepared.reviewTargets,
      primaryCandidates: prepared.primaryCandidates,
      allCandidates: prepared.allCandidates,
      questionCount: input.totalQuestionCount,
      englishToKoreanRatio: input.englishToKoreanRatio,
    });
  } catch (error) {
    throw new MixedAssignmentError(
      "invalid_selection",
      error instanceof Error
        ? error.message
        : `현재 조건에서는 최대 ${capacity.maximumQuestionCount}문항까지 배정할 수 있습니다.`,
    );
  }

  const reviewLevels = [...input.reviewLevels].sort(
    (left, right) => left - right,
  );
  const selectedQueueIds = prepared.selectedQueueRows.map(
    (queue) => queue.id,
  );
  const datasetLabel = await memoizeRequestPreparation(
    prepared.preparationCache.datasetLabels,
    prepared.dataset.id,
    () => loadDatasetDisplayLabel(prepared.supabase, prepared.dataset),
  );
  return {
    studentId: input.studentId,
    datasetId: input.datasetId,
    reviewLevels,
    reviewScope: input.reviewScope ?? "dataset",
    selectedQueueIds,
    title:
      input.title ||
      mixedAssignmentGeneratedTitle(
        datasetLabel,
        prepared.primaryUnits,
        prepared.selectedQueueRows.length,
        input.totalQuestionCount,
      )
        .slice(0, MAX_ASSIGNMENT_TITLE_LENGTH)
        .trimEnd(),
    primaryUnitIds: mixedAssignmentPrimaryUnitIds(
      prepared.primaryUnits.map((unit) => unit.id),
      prepared.selectedQueueRows.length,
      input.totalQuestionCount,
    ),
    englishToKoreanRatio: input.englishToKoreanRatio,
    timeLimitSeconds: input.timeLimitSeconds,
    passingScore: input.passingScore,
    retryEnabled: input.retryEnabled,
    retryPassingScore: input.retryPassingScore,
    questionOrderMode: input.questionOrderMode,
    availableUntil: input.availableUntil,
    timingMode: input.timingMode ?? "total",
    questionTimeLimitSeconds:
      input.timingMode === "per_question"
        ? (input.questionTimeLimitSeconds ?? null)
        : null,
    questions: questionDrafts.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      base_order_index: index + 1,
      direction: question.direction,
      choice_vocab_entry_ids: question.choiceVocabEntryIds,
    })),
  };
}

export async function prepareMixedAssignmentBatch(
  input: MixedAssignmentInput,
  authenticatedAdmin?: AdminContext,
  exclusion?: AssignmentExclusion,
  cache?: MixedAssignmentPreparationCache,
) {
  return preparePendingReviewAssignmentBatch(
    input,
    authenticatedAdmin,
    exclusion,
    cache,
  );
}

export async function createMixedAssignment(
  input: MixedAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  const prepared = await prepareMixedAssignmentBatch(
    input,
    authenticatedAdmin,
  );
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_mixed_review_assignment_v10",
    {
      p_student_id: prepared.studentId,
      p_dataset_id: prepared.datasetId,
      p_review_levels: prepared.reviewLevels,
      p_review_scope: prepared.reviewScope,
      p_selected_queue_ids: prepared.selectedQueueIds,
      p_title: prepared.title,
      p_primary_unit_ids: prepared.primaryUnitIds,
      p_english_to_korean_ratio: prepared.englishToKoreanRatio,
      p_time_limit_seconds: prepared.timeLimitSeconds,
      p_passing_score: prepared.passingScore,
      p_retry_enabled: prepared.retryEnabled,
      p_retry_passing_score: prepared.retryPassingScore,
      p_question_order_mode: prepared.questionOrderMode,
      p_available_until: prepared.availableUntil,
      p_timing_mode: prepared.timingMode,
      p_question_time_limit_seconds:
        prepared.questionTimeLimitSeconds,
      p_questions: prepared.questions,
    },
  );

  if (error) {
    console.error("[mixed-assignment] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw new MixedAssignmentError(
      mixedAssignmentDatabaseErrorReason(error),
    );
  }
  if (!z.uuid().safeParse(data).success) {
    throw new MixedAssignmentError("database");
  }
  return data as string;
}
