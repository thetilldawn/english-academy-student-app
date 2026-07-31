import "server-only";

import { z } from "zod";

import {
  excludePendingReviewCandidates,
  mixedAssignmentDatabaseErrorReason,
  orderContiguousPrimaryUnits,
  type MixedAssignmentFailureReason,
  type MixedAssignmentUnit,
  type PendingReviewIdentity,
} from "@/lib/admin/mixed-assignment";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";
import {
  createMixedQuizQuestions,
  quizVocabularyIdentity,
} from "@/lib/quiz/engine";
import {
  activeReviewIdentity,
  loadActiveReviewAssignments,
} from "@/lib/services/active-review-assignment-service";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  AssignmentCapacityInput,
  MixedAssignmentInput,
} from "@/lib/validation";

const REVIEW_QUEUE_PAGE_SIZE = 1000;
const MAX_ASSIGNMENT_TITLE_LENGTH = 160;
const MAX_MIXED_REVIEW_WORDS = 500;
const CAPACITY_RANDOM = () => 0.5;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type ReviewQueueRow = {
  id: string;
  vocab_entry_id: number;
  canonical_lexeme_id_snapshot: string | null;
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

export type AssignmentCapacity = {
  unitEligible: number;
  wrongEligible: number;
  overlap: number;
  alreadyAssigned: number;
  maximumQuestionCount: number;
  recommendedQuestionCount: number;
  minimumQuestionCount: number;
};

type PreparedAssignment = {
  supabase: ServerSupabaseClient;
  dataset: DatasetRow;
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

function queueIdentity(
  queue: ReviewQueueRow,
  candidate?: EligibleVocabularyEntry,
) {
  if (candidate) return quizVocabularyIdentity(candidate);
  return queue.canonical_lexeme_id_snapshot
    ? `canonical:${queue.canonical_lexeme_id_snapshot}`
    : `entry:${queue.vocab_entry_id}`;
}

function uniqueIdentityCount(
  entries: readonly EligibleVocabularyEntry[],
) {
  return new Set(entries.map(entryIdentity)).size;
}

async function loadReviewQueueRows(
  supabase: ServerSupabaseClient,
  studentId: string,
  datasetId: string,
  reviewLevels: readonly (1 | 2)[],
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
        "id, vocab_entry_id, canonical_lexeme_id_snapshot, reason_level, queued_at, reserved_review_draft_id",
      )
      .eq("student_id", studentId)
      .eq("dataset_id", datasetId)
      .eq("status", "pending")
      .is("reserved_review_draft_id", null)
      .in("reason_level", [...reviewLevels])
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

function calculateRegularMaximum(
  candidates: readonly EligibleVocabularyEntry[],
  allCandidates: readonly EligibleVocabularyEntry[],
  ratio: 0 | 50 | 100,
) {
  const upper = Math.min(500, uniqueIdentityCount(candidates));
  for (let count = upper; count >= 4; count -= 1) {
    try {
      createMixedQuizQuestions(
        [],
        candidates,
        allCandidates,
        count,
        ratio,
        CAPACITY_RANDOM,
      );
      return count;
    } catch {
      // Try the next smaller count. The same generator is used for creation.
    }
  }
  return 0;
}

function calculateMixedMaximum(
  reviewTargets: readonly EligibleVocabularyEntry[],
  primaryCandidates: readonly EligibleVocabularyEntry[],
  allCandidates: readonly EligibleVocabularyEntry[],
  ratio: 0 | 50 | 100,
) {
  const minimum = Math.max(4, reviewTargets.length);
  const upper = Math.min(
    500,
    reviewTargets.length + uniqueIdentityCount(primaryCandidates),
  );
  for (let count = upper; count >= minimum; count -= 1) {
    try {
      createMixedQuizQuestions(
        reviewTargets,
        primaryCandidates,
        allCandidates,
        count,
        ratio,
        CAPACITY_RANDOM,
      );
      return count;
    } catch {
      // Try the next smaller count. The same generator is used for creation.
    }
  }
  return 0;
}

function generatedMixedTitle(
  datasetTitle: string,
  datasetEdition: string | null,
  units: readonly MixedAssignmentUnit[],
  reviewCount: number,
) {
  const unitRange =
    units.length === 1
      ? units[0].unitLabel
      : `${units[0].unitLabel}~${units.at(-1)?.unitLabel}`;
  return [
    datasetTitle,
    datasetEdition,
    unitRange,
    `틀렸던 단어 ${reviewCount}개 포함`,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, MAX_ASSIGNMENT_TITLE_LENGTH)
    .trimEnd();
}

async function prepareAssignment(
  input: AssignmentCapacityInput,
  authenticatedAdmin?: AdminContext,
): Promise<PreparedAssignment> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }

  const supabase = await createServerSupabaseClient();
  const reviewLevels = [...input.reviewLevels].sort(
    (left, right) => left - right,
  );
  const [
    { data: student, error: studentError },
    { data: datasetData, error: datasetError },
    { data: unitData, error: unitError },
    allCandidates,
    queueRows,
    activeReviewAssignments,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, status")
      .eq("id", input.studentId)
      .maybeSingle(),
    supabase
      .from("vocab_datasets")
      .select("id, title, edition, status, is_active")
      .eq("id", input.datasetId)
      .maybeSingle(),
    supabase
      .from("vocab_units")
      .select("id, unit_label, sort_index")
      .eq("dataset_id", input.datasetId)
      .order("sort_index"),
    loadEligibleVocabularyDataset(supabase, input.datasetId),
    input.includePendingReview
      ? loadReviewQueueRows(
          supabase,
          input.studentId,
          input.datasetId,
          reviewLevels,
        )
      : Promise.resolve([]),
    loadActiveReviewAssignments(
      supabase,
      [input.studentId],
      input.datasetId,
    ),
  ]);

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
    primaryUnits = orderContiguousPrimaryUnits(
      ((unitData ?? []) as UnitRow[]).map((unit) => ({
        id: unit.id,
        unitLabel: unit.unit_label,
        sortIndex: unit.sort_index,
      })),
      input.primaryUnitIds,
    );
  } catch {
    throw new MixedAssignmentError("invalid_selection");
  }

  const candidateById = new Map(
    allCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const availableQueueRows = queueRows.filter((row) => {
    const candidate = candidateById.get(row.vocab_entry_id);
    return (
      !activeReviewAssignments.queueIds.has(row.id) &&
      !activeReviewAssignments.identities.has(
        queueIdentity(row, candidate),
      )
    );
  });
  const selectedByIdentity = new Map<string, ReviewQueueRow>();
  for (const row of availableQueueRows) {
    const identity = queueIdentity(
      row,
      candidateById.get(row.vocab_entry_id),
    );
    if (!selectedByIdentity.has(identity)) {
      selectedByIdentity.set(identity, row);
    }
  }
  const selectedQueueRows = [...selectedByIdentity.values()].slice(
    0,
    MAX_MIXED_REVIEW_WORDS,
  );
  const reviewTargets = selectedQueueRows.flatMap((queue) => {
    const candidate = candidateById.get(queue.vocab_entry_id);
    return candidate ? [candidate] : [];
  });
  if (reviewTargets.length !== selectedQueueRows.length) {
    throw new MixedAssignmentError(
      "invalid_selection",
      "틀렸던 단어 중 현재 출제할 수 없는 항목이 있습니다.",
    );
  }
  if (
    selectedQueueRows.some((queue, index) => {
      const candidate = reviewTargets[index];
      return (
        queue.canonical_lexeme_id_snapshot !== null &&
        queue.canonical_lexeme_id_snapshot !== candidate?.canonicalKey
      );
    })
  ) {
    throw new MixedAssignmentError("conflict");
  }

  const primaryUnitIdSet = new Set(
    primaryUnits.map((unit) => unit.id),
  );
  const unitCandidates = allCandidates.filter(
    (candidate) =>
      primaryUnitIdSet.has(candidate.unitId) &&
      !activeReviewAssignments.identities.has(
        activeReviewIdentity(
          candidate.id,
          candidate.canonicalKey,
          candidate.headwordNormalized,
        ),
      ),
  );
  const selectedReviewIdentities: PendingReviewIdentity[] =
    selectedQueueRows.map((queue, index) => ({
      vocabEntryId: queue.vocab_entry_id,
      canonicalKey: queue.canonical_lexeme_id_snapshot,
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
  const maximumQuestionCount = input.includePendingReview
    ? calculateMixedMaximum(
        reviewTargets,
        primaryCandidates,
        allCandidates,
        input.englishToKoreanRatio,
      )
    : calculateRegularMaximum(
        primaryCandidates,
        primaryCandidates,
        input.englishToKoreanRatio,
      );
  const minimumQuestionCount = input.includePendingReview
    ? Math.max(4, reviewTargets.length)
    : 4;
  const capacity: AssignmentCapacity = {
    unitEligible: uniqueIdentityCount(unitCandidates),
    wrongEligible: reviewTargets.length,
    overlap,
    alreadyAssigned: queueRows.filter((row) =>
      activeReviewAssignments.queueIds.has(row.id) ||
      activeReviewAssignments.identities.has(
        queueIdentity(
          row,
          candidateById.get(row.vocab_entry_id),
        ),
      ),
    ).length,
    maximumQuestionCount,
    recommendedQuestionCount: maximumQuestionCount,
    minimumQuestionCount,
  };

  return {
    supabase,
    dataset,
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
) {
  const prepared = await prepareAssignment(input, authenticatedAdmin);
  return prepared.capacity;
}

export async function createMixedAssignment(
  input: MixedAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= Date.now()
  ) {
    throw new MixedAssignmentError(
      "invalid_selection",
      "응시 시작 마감은 현재보다 뒤로 정해 주세요.",
    );
  }

  const prepared = await prepareAssignment(
    {
      studentId: input.studentId,
      datasetId: input.datasetId,
      primaryUnitIds: input.primaryUnitIds,
      includePendingReview: true,
      reviewLevels: input.reviewLevels,
      englishToKoreanRatio: input.englishToKoreanRatio,
    },
    authenticatedAdmin,
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
      capacity.maximumQuestionCount > 0
        ? `현재 조건에서는 ${capacity.minimumQuestionCount}~${capacity.maximumQuestionCount}문항으로 배정할 수 있습니다.`
        : "현재 범위와 출제 방향으로 만들 수 있는 시험이 없습니다.",
    );
  }

  let questionDrafts;
  try {
    questionDrafts = createMixedQuizQuestions(
      prepared.reviewTargets,
      prepared.primaryCandidates,
      prepared.allCandidates,
      input.totalQuestionCount,
      input.englishToKoreanRatio,
    );
  } catch {
    throw new MixedAssignmentError(
      "invalid_selection",
      `현재 조건에서는 최대 ${capacity.maximumQuestionCount}문항까지 배정할 수 있습니다.`,
    );
  }

  const reviewLevels = [...input.reviewLevels].sort(
    (left, right) => left - right,
  );
  const selectedQueueIds = prepared.selectedQueueRows.map(
    (queue) => queue.id,
  );
  const { data, error } = await prepared.supabase.rpc(
    "create_mixed_review_assignment_v6",
    {
      p_student_id: input.studentId,
      p_dataset_id: input.datasetId,
      p_review_levels: reviewLevels,
      p_selected_queue_ids: selectedQueueIds,
      p_title:
        input.title ||
        generatedMixedTitle(
          prepared.dataset.title,
          prepared.dataset.edition,
          prepared.primaryUnits,
          prepared.selectedQueueRows.length,
        ),
      p_primary_unit_ids: prepared.primaryUnits.map(
        (unit) => unit.id,
      ),
      p_english_to_korean_ratio: input.englishToKoreanRatio,
      p_time_limit_seconds: input.timeLimitSeconds,
      p_passing_score: input.passingScore,
      p_question_order_mode: input.questionOrderMode,
      p_available_until: input.availableUntil,
      p_timing_mode: input.timingMode ?? "total",
      p_question_time_limit_seconds:
        input.timingMode === "per_question"
          ? (input.questionTimeLimitSeconds ?? null)
          : null,
      p_questions: questionDrafts.map((question, index) => ({
        vocab_entry_id: question.vocabEntryId,
        base_order_index: index + 1,
        direction: question.direction,
        choice_vocab_entry_ids: question.choiceVocabEntryIds,
      })),
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
