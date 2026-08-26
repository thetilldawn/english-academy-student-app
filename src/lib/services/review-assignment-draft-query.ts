import "server-only";

import type { ReviewAssignmentDraftSummary } from "@/lib/admin/review-assignment";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { loadDatasetDisplayLabel } from "@/lib/services/dataset-catalog-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ID_FILTER_CHUNK_SIZE = 80;
const MAX_ASSIGNMENT_TITLE_LENGTH = 160;
const REVIEW_TITLE_SUFFIX = " · 오답 시험";

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

export type ReviewDraftContext = {
  summary: ReviewAssignmentDraftSummary;
  targetEntryIds: number[];
};

function generatedReviewTitle(datasetLabel: string) {
  const prefixLimit =
    MAX_ASSIGNMENT_TITLE_LENGTH - REVIEW_TITLE_SUFFIX.length;
  return `${datasetLabel.slice(0, prefixLimit).trimEnd()}${REVIEW_TITLE_SUFFIX}`;
}

export async function loadReviewDraftContext(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  reviewDraftId: string,
): Promise<ReviewDraftContext | null> {
  const { data: draftData, error: draftError } = await supabase
    .from("student_vocab_review_assignment_drafts")
    .select("id, student_id, dataset_id, status, expires_at")
    .eq("id", reviewDraftId)
    .maybeSingle();
  if (draftError) {
    throw new Error("오답 시험 초안을 불러오지 못했습니다.");
  }
  const draft = draftData as DraftRow | null;
  if (
    !draft ||
    draft.status !== "pending" ||
    Date.parse(draft.expires_at) <= Date.now()
  ) {
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
    throw new Error("오답 시험 초안의 연결 정보를 불러오지 못했습니다.");
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
    throw new Error("오답 시험 초안 항목이 올바르지 않습니다.");
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
      throw new Error("오답 시험 대기 단어를 불러오지 못했습니다.");
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
    throw new Error("오답 시험 대상 단어가 올바르지 않습니다.");
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
