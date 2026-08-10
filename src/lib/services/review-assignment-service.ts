import "server-only";

import { z } from "zod";

import type { ReviewAssignmentDraftSummary } from "@/lib/admin/review-assignment";
import {
  isAssignmentPersistenceInvariantFailure,
} from "@/lib/admin/assignment-database-error";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  createTargetedQuizQuestions,
} from "@/lib/quiz/engine";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { loadDatasetDisplayLabel } from "@/lib/services/dataset-catalog-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

const REVIEW_DRAFT_FINALIZE_LIMIT = 400;
const ID_FILTER_CHUNK_SIZE = 80;
const MAX_ASSIGNMENT_TITLE_LENGTH = 160;
const REVIEW_TITLE_SUFFIX = " · 오답 재시험";

type DraftRow = {
  id: string;
  student_id: string;
  dataset_id: string;
  status: "pending" | "consumed" | "cancelled" | "expired";
  expires_at: string;
};

type DraftItemRow = {
  queue_id: string;
  position: number;
};

type ReviewQueueRow = {
  id: string;
  vocab_entry_id: number;
};

type ReviewDraftContext = {
  summary: ReviewAssignmentDraftSummary;
  targetEntryIds: number[];
};

function generatedReviewTitle(datasetLabel: string) {
  const prefixLimit =
    MAX_ASSIGNMENT_TITLE_LENGTH - REVIEW_TITLE_SUFFIX.length;
  return `${datasetLabel.slice(0, prefixLimit).trimEnd()}${REVIEW_TITLE_SUFFIX}`;
}

export type ExactReviewAssignmentInput = {
  reviewDraftId: string;
  title: string;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  timingMode?: TimingMode;
  questionTimeLimitSeconds?: number | null;
  passingScore: number;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
};

export class ReviewAssignmentError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "unavailable"
      | "invalid_selection"
      | "conflict"
      | "database",
    message = "오답 재시험을 배정하지 못했습니다.",
  ) {
    super(message);
    this.name = "ReviewAssignmentError";
  }
}

export class ReviewAssignmentDraftCancelError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "not_found"
      | "unavailable"
      | "database",
  ) {
    super("오답 재시험 준비를 취소하지 못했습니다.");
    this.name = "ReviewAssignmentDraftCancelError";
  }
}

export async function cancelStudentReviewAssignmentDraft(
  studentId: string,
  reviewDraftId: string,
  authenticatedAdmin?: AdminContext,
) {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "cancel_student_vocab_review_assignment_draft",
    {
      p_student_id: studentId,
      p_review_draft_id: reviewDraftId,
    },
  );

  if (error) {
    console.error("[review-assignment-draft-cancel] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw new ReviewAssignmentDraftCancelError(
      error.code === "42501"
        ? "forbidden"
        : error.code === "P0002"
          ? "not_found"
          : error.code === "40001"
            ? "unavailable"
            : "database",
    );
  }

  if (data !== "cancelled") {
    throw new ReviewAssignmentDraftCancelError("database");
  }

  return data;
}

export async function finalizeExpiredReviewAssignmentDrafts(
  studentId: string,
) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "finalize_expired_review_assignment_drafts",
    {
      p_student_id: studentId,
      p_limit: REVIEW_DRAFT_FINALIZE_LIMIT,
    },
  );
  const finalizedCount =
    typeof data === "number" ? data : Number(data);
  if (
    error ||
    !Number.isSafeInteger(finalizedCount) ||
    finalizedCount < 0
  ) {
    throw new Error("만료된 오답 재시험 초안을 정리하지 못했습니다.");
  }
  return finalizedCount;
}

async function loadReviewDraftContext(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  reviewDraftId: string,
): Promise<ReviewDraftContext | null> {
  const { data: draftData, error: draftError } = await supabase
    .from("student_vocab_review_assignment_drafts")
    .select("id, student_id, dataset_id, status, expires_at")
    .eq("id", reviewDraftId)
    .maybeSingle();
  if (draftError) {
    throw new Error("오답 재시험 초안을 불러오지 못했습니다.");
  }
  const draft = draftData as DraftRow | null;
  if (!draft || draft.status !== "pending") return null;

  if (Date.parse(draft.expires_at) <= Date.now()) {
    await finalizeExpiredReviewAssignmentDrafts(draft.student_id);
    return null;
  }

  const [
    { data: student, error: studentError },
    { data: dataset, error: datasetError },
    { data: itemData, error: itemError },
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, display_name, school_name, grade_label, status")
      .eq("id", draft.student_id)
      .maybeSingle(),
    supabase
      .from("vocab_datasets")
      .select("id, title, edition, status, is_active")
      .eq("id", draft.dataset_id)
      .maybeSingle(),
    supabase
      .from("student_vocab_review_assignment_draft_items")
      .select("queue_id, position")
      .eq("draft_id", reviewDraftId)
      .order("position"),
  ]);

  if (studentError || datasetError || itemError) {
    throw new Error("오답 재시험 초안의 연결 정보를 불러오지 못했습니다.");
  }
  if (
    !student ||
    student.status !== "active" ||
    !dataset ||
    dataset.status !== "ready" ||
    !dataset.is_active
  ) {
    return null;
  }

  const items = (itemData ?? []) as DraftItemRow[];
  if (
    items.length < 1 ||
    items.length > 400 ||
    new Set(items.map((item) => item.queue_id)).size !== items.length ||
    items.some((item, index) => item.position !== index + 1)
  ) {
    throw new Error("오답 재시험 초안 항목이 올바르지 않습니다.");
  }

  const queueIds = items.map((item) => item.queue_id);
  const queueRows: ReviewQueueRow[] = [];
  for (
    let offset = 0;
    offset < queueIds.length;
    offset += ID_FILTER_CHUNK_SIZE
  ) {
    const queueIdChunk = queueIds.slice(
      offset,
      offset + ID_FILTER_CHUNK_SIZE,
    );
    const { data, error } = await supabase
      .from("student_vocab_review_queue")
      .select("id, vocab_entry_id")
      .in("id", queueIdChunk)
      .eq("student_id", draft.student_id)
      .eq("dataset_id", draft.dataset_id)
      .eq("status", "pending")
      .eq("reserved_review_draft_id", reviewDraftId);
    if (error) {
      throw new Error("오답 재시험 대기 단어를 불러오지 못했습니다.");
    }
    queueRows.push(...((data ?? []) as ReviewQueueRow[]));
  }
  if (queueRows.length !== items.length) return null;

  const queueById = new Map(queueRows.map((row) => [row.id, row]));
  const targetEntryIds = items.flatMap((item) => {
    const queue = queueById.get(item.queue_id);
    return queue ? [queue.vocab_entry_id] : [];
  });
  if (
    targetEntryIds.length !== items.length ||
    new Set(targetEntryIds).size !== targetEntryIds.length
  ) {
    throw new Error("오답 재시험 대상 단어가 올바르지 않습니다.");
  }

  const datasetLabel = await loadDatasetDisplayLabel(supabase, dataset);
  return {
    summary: {
      id: draft.id,
      studentId: draft.student_id,
      studentName: student.display_name,
      schoolName: student.school_name,
      gradeLabel: student.grade_label,
      datasetId: draft.dataset_id,
      datasetLabel,
      questionCount: items.length,
      expiresAt: draft.expires_at,
      generatedTitle: generatedReviewTitle(datasetLabel),
    },
    targetEntryIds,
  };
}

export async function getReviewAssignmentDraftSummary(
  reviewDraftId: string,
  authenticatedAdmin?: AdminContext,
): Promise<ReviewAssignmentDraftSummary | null> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  return (await loadReviewDraftContext(supabase, reviewDraftId))?.summary ?? null;
}

export async function createExactReviewAssignment(
  input: ExactReviewAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= Date.now()
  ) {
    throw new ReviewAssignmentError("invalid_selection");
  }

  const supabase = await createServerSupabaseClient();
  const context = await loadReviewDraftContext(
    supabase,
    input.reviewDraftId,
  );
  if (!context) {
    throw new ReviewAssignmentError("unavailable");
  }

  const candidates = await loadEligibleVocabularyDataset(
    supabase,
    context.summary.datasetId,
  );
  const candidateById = new Map(
    candidates.map((entry) => [entry.id, entry]),
  );
  const targets = context.targetEntryIds.flatMap((entryId) => {
    const entry = candidateById.get(entryId);
    return entry ? [entry] : [];
  });
  if (targets.length !== context.targetEntryIds.length) {
    throw new ReviewAssignmentError("invalid_selection");
  }

  let questionDrafts;
  try {
    questionDrafts = createTargetedQuizQuestions(
      targets,
      candidates,
      input.englishToKoreanRatio,
    );
  } catch {
    throw new ReviewAssignmentError("invalid_selection");
  }

  const { data, error } = await supabase.rpc(
    "create_exact_review_assignment_v4",
    {
      p_review_draft_id: input.reviewDraftId,
      p_title: input.title || context.summary.generatedTitle,
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
    console.error("[exact-review-assignment] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    const reason = isAssignmentPersistenceInvariantFailure(error)
      ? "database"
      : error.code === "42501"
        ? "forbidden"
        : error.code === "40001"
          ? "conflict"
          : ["22023", "P0002", "23503", "23505"].includes(error.code)
            ? "invalid_selection"
            : "database";
    throw new ReviewAssignmentError(reason);
  }
  if (!z.uuid().safeParse(data).success) {
    throw new ReviewAssignmentError("database");
  }
  const assignmentId = data as string;
  const { error: deliveryError } = await supabase.rpc(
    "configure_assignment_delivery_v1",
    {
      p_assignment_id: assignmentId,
      p_timing_mode: input.timingMode ?? "total",
      p_question_time_limit_seconds:
        input.timingMode === "per_question"
          ? (input.questionTimeLimitSeconds ?? null)
          : null,
    },
  );
  if (deliveryError) {
    await supabase
      .from("assignments")
      .update({ status: "closed" })
      .eq("id", assignmentId);
    throw new ReviewAssignmentError("database");
  }
  return assignmentId;
}
