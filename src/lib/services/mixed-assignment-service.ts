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
import { createMixedQuizQuestions } from "@/lib/quiz/engine";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { MixedAssignmentInput } from "@/lib/validation";

const REVIEW_QUEUE_PAGE_SIZE = 1000;
const MAX_ASSIGNMENT_TITLE_LENGTH = 160;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type ReviewQueueRow = {
  id: string;
  vocab_entry_id: number;
  canonical_lexeme_id_snapshot: string | null;
  reason_level: 1 | 2;
  queued_at: string;
};

type UnitRow = {
  id: string;
  unit_label: string;
  sort_index: number;
};

export class MixedAssignmentError extends Error {
  constructor(
    public readonly reason: MixedAssignmentFailureReason,
    message = "DAY+오답 시험을 배정하지 못했습니다.",
  ) {
    super(message);
    this.name = "MixedAssignmentError";
  }
}

async function loadAllPendingReviewIdentities(
  supabase: ServerSupabaseClient,
  studentId: string,
  datasetId: string,
): Promise<PendingReviewIdentity[]> {
  const rows: PendingReviewIdentity[] = [];
  for (
    let offset = 0;
    ;
    offset += REVIEW_QUEUE_PAGE_SIZE
  ) {
    const { data, error } = await supabase
      .from("student_vocab_review_queue")
      .select("vocab_entry_id, canonical_lexeme_id_snapshot")
      .eq("student_id", studentId)
      .eq("dataset_id", datasetId)
      .eq("status", "pending")
      .order("id")
      .range(offset, offset + REVIEW_QUEUE_PAGE_SIZE - 1);
    if (error) {
      throw new MixedAssignmentError("database");
    }
    rows.push(
      ...((data ?? []).map((row) => ({
        vocabEntryId: row.vocab_entry_id,
        canonicalKey: row.canonical_lexeme_id_snapshot,
      })) as PendingReviewIdentity[]),
    );
    if (!data || data.length < REVIEW_QUEUE_PAGE_SIZE) break;
  }
  return rows;
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
    `오답 ${reviewCount}개 포함`,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, MAX_ASSIGNMENT_TITLE_LENGTH)
    .trimEnd();
}

export async function createMixedAssignment(
  input: MixedAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= Date.now()
  ) {
    throw new MixedAssignmentError("invalid_selection");
  }

  const supabase = await createServerSupabaseClient();
  const [
    { data: student, error: studentError },
    { data: dataset, error: datasetError },
    { data: unitData, error: unitError },
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
  ]);

  if (studentError || datasetError || unitError) {
    throw new MixedAssignmentError("database");
  }
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

  const reviewLevels = [...input.reviewLevels].sort(
    (left, right) => left - right,
  );
  let selectedQueueRows: ReviewQueueRow[];
  let pendingIdentities: PendingReviewIdentity[];
  let allCandidates: Awaited<
    ReturnType<typeof loadEligibleVocabularyDataset>
  >;
  try {
    const [
      { data: queueData, error: queueError },
      loadedPendingIdentities,
      loadedCandidates,
    ] = await Promise.all([
      supabase
        .from("student_vocab_review_queue")
        .select(
          "id, vocab_entry_id, canonical_lexeme_id_snapshot, reason_level, queued_at",
        )
        .eq("student_id", input.studentId)
        .eq("dataset_id", input.datasetId)
        .eq("status", "pending")
        .is("reserved_review_draft_id", null)
        .in("reason_level", reviewLevels)
        .order("reason_level", { ascending: false })
        .order("queued_at")
        .order("id")
        .limit(input.reviewLimit),
      loadAllPendingReviewIdentities(
        supabase,
        input.studentId,
        input.datasetId,
      ),
      loadEligibleVocabularyDataset(supabase, input.datasetId),
    ]);
    if (queueError) {
      throw new MixedAssignmentError("database");
    }
    selectedQueueRows = (queueData ?? []) as ReviewQueueRow[];
    pendingIdentities = loadedPendingIdentities;
    allCandidates = loadedCandidates;
  } catch (error) {
    if (error instanceof MixedAssignmentError) throw error;
    throw new MixedAssignmentError("database");
  }

  if (selectedQueueRows.length === 0) {
    throw new MixedAssignmentError("unavailable");
  }
  if (selectedQueueRows.length >= input.totalQuestionCount) {
    throw new MixedAssignmentError("invalid_selection");
  }
  const candidateById = new Map(
    allCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const reviewTargets = selectedQueueRows.flatMap((queue) => {
    const candidate = candidateById.get(queue.vocab_entry_id);
    return candidate ? [candidate] : [];
  });
  if (reviewTargets.length !== selectedQueueRows.length) {
    throw new MixedAssignmentError("invalid_selection");
  }
  if (
    selectedQueueRows.some((queue, index) => {
      const candidate = reviewTargets[index];
      return (
        queue.canonical_lexeme_id_snapshot !== null &&
        queue.canonical_lexeme_id_snapshot !==
          candidate?.canonicalKey
      );
    })
  ) {
    throw new MixedAssignmentError("conflict");
  }

  const primaryUnitIds = primaryUnits.map((unit) => unit.id);
  const primaryUnitIdSet = new Set(primaryUnitIds);
  const primaryCandidates = excludePendingReviewCandidates(
    allCandidates.filter((candidate) =>
      primaryUnitIdSet.has(candidate.unitId),
    ),
    pendingIdentities,
  );

  let questionDrafts;
  try {
    questionDrafts = createMixedQuizQuestions(
      reviewTargets,
      primaryCandidates,
      allCandidates,
      input.totalQuestionCount,
      input.englishToKoreanRatio,
    );
  } catch {
    throw new MixedAssignmentError("invalid_selection");
  }

  const selectedQueueIds = selectedQueueRows.map((queue) => queue.id);
  const { data, error } = await supabase.rpc(
    "create_mixed_review_assignment_v5",
    {
      p_student_id: input.studentId,
      p_dataset_id: input.datasetId,
      p_review_levels: reviewLevels,
      p_review_limit: input.reviewLimit,
      p_selected_queue_ids: selectedQueueIds,
      p_title:
        input.title ||
        generatedMixedTitle(
          dataset.title,
          dataset.edition,
          primaryUnits,
          selectedQueueRows.length,
        ),
      p_primary_unit_ids: primaryUnitIds,
      p_english_to_korean_ratio: input.englishToKoreanRatio,
      p_time_limit_seconds: input.timeLimitSeconds,
      p_passing_score: input.passingScore,
      p_question_order_mode: input.questionOrderMode,
      p_available_until: input.availableUntil,
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
