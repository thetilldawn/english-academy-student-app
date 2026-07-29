import "server-only";

import { z } from "zod";

import {
  emptyStudentWrongWordHistory,
  buildStudentWrongWordHistory,
  wrongWordReviewIdentity,
  type PendingWrongWordReview,
  type StudentWrongWordHistory,
  type WrongAttemptSource,
  type WrongEntrySource,
  type WrongEventSource,
  type WrongQuestionSource,
} from "@/lib/admin/wrong-word-history";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { finalizeStaleQuizAttempts } from "@/lib/services/stale-attempt-service";
import { finalizeExpiredReviewAssignmentDrafts } from "@/lib/services/review-assignment-service";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Aggregate and per-attempt views intentionally duplicate labels. Keep a
// conservative response-size ceiling until cursor-paged history is added.
const MAX_WRONG_EVENTS = 400;
const WRONG_EVENT_PAGE_SIZE = 200;
const RELATION_CHUNK_SIZE = 200;

type WrongEventRow = {
  id: number | string;
  quiz_attempt_id: string;
  quiz_question_id: string;
  dataset_id: string;
  vocab_entry_id: number;
  canonical_lexeme_id_snapshot: string | null;
  wrong_stage: "initial" | "retry";
  wrong_at: string;
};

type AttemptRow = {
  id: string;
  attempt_number: number;
  status: "completed" | "expired";
  completed_at: string;
  assignment: { title: string } | Array<{ title: string }> | null;
};

type QuestionSnapshot = {
  headword_snapshot: string | null;
  primary_meaning_snapshot: string | null;
  provenance_status: "legacy_backfill" | "verified_v2";
};

type QuestionRow = {
  id: string;
  vocab_entry_id: number;
  initial_is_correct: boolean | null;
  retry_is_correct: boolean | null;
  assignment_question:
    | QuestionSnapshot
    | QuestionSnapshot[]
    | null;
};

type DatasetRelation = {
  title: string;
  edition: string | null;
};

type EntryRow = {
  id: number;
  dataset_id: string;
  headword: string;
  primary_meaning: string;
  dataset: DatasetRelation | DatasetRelation[] | null;
};

type PendingReviewRow = {
  id: string;
  dataset_id: string;
  vocab_entry_id: number;
  canonical_lexeme_id_snapshot: string | null;
  source_question_id: string;
  reason_level: 1 | 2;
  queued_at: string;
  reserved_review_draft_id: string | null;
};

export class WrongWordQueueError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "invalid_selection"
      | "database",
  ) {
    super("오답 단어를 다음 시험 대기열에 추가하지 못했습니다.");
    this.name = "WrongWordQueueError";
  }
}

export class ReviewAssignmentDraftError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "invalid_selection"
      | "conflict"
      | "database",
  ) {
    super("오답 재시험 배정 준비에 실패했습니다.");
    this.name = "ReviewAssignmentDraftError";
  }
}

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function chunks<T>(values: readonly T[]) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += RELATION_CHUNK_SIZE) {
    result.push(values.slice(index, index + RELATION_CHUNK_SIZE));
  }
  return result;
}

export async function getStudentWrongWordHistory(
  studentId: string,
  authenticatedAdmin?: AdminContext,
): Promise<StudentWrongWordHistory | null> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  await finalizeStaleQuizAttempts();
  const supabase = getServiceSupabaseClient();
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .maybeSingle();

  if (studentError || !student) return null;
  await finalizeExpiredReviewAssignmentDrafts(studentId);
  const eventRows: WrongEventRow[] = [];
  let beforeId: number | string | null = null;

  while (eventRows.length <= MAX_WRONG_EVENTS) {
    const pageLimit = Math.min(
      WRONG_EVENT_PAGE_SIZE,
      MAX_WRONG_EVENTS + 1 - eventRows.length,
    );
    let query = supabase
      .from("student_vocab_wrong_events")
      .select(
        "id, quiz_attempt_id, quiz_question_id, dataset_id, vocab_entry_id, canonical_lexeme_id_snapshot, wrong_stage, wrong_at",
      )
      .eq("student_id", studentId)
      .order("id", { ascending: false })
      .limit(pageLimit);
    if (beforeId !== null) {
      query = query.lt("id", beforeId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error("오답 이력을 불러오지 못했습니다.");
    }
    const page = (data ?? []) as WrongEventRow[];
    eventRows.push(...page);
    if (page.length < pageLimit) break;
    beforeId = page.at(-1)?.id ?? null;
    if (beforeId === null) break;
  }
  if (eventRows.length > MAX_WRONG_EVENTS) {
    throw new Error(
      "오답 이력이 현재 조회 한도를 넘었습니다. 기간별 조회가 필요합니다.",
    );
  }
  const { data: pendingReviewData, error: pendingReviewError } =
    await supabase
      .from("student_vocab_review_queue")
      .select(
        "id, dataset_id, vocab_entry_id, canonical_lexeme_id_snapshot, source_question_id, reason_level, queued_at, reserved_review_draft_id",
      )
      .eq("student_id", studentId)
      .eq("status", "pending")
      .order("queued_at", { ascending: false })
      .limit(MAX_WRONG_EVENTS + 1);
  if (pendingReviewError) {
    throw new Error("오답 복습 대기열을 불러오지 못했습니다.");
  }
  if ((pendingReviewData?.length ?? 0) > MAX_WRONG_EVENTS) {
    throw new Error(
      "오답 복습 대기열이 현재 조회 한도를 넘었습니다. 먼저 시험으로 배정해 주세요.",
    );
  }
  const pendingReviews = (
    (pendingReviewData ?? []) as PendingReviewRow[]
  ).map(
    (row): PendingWrongWordReview => ({
      queueId: row.id,
      key: wrongWordReviewIdentity(
        row.dataset_id,
        row.vocab_entry_id,
        row.canonical_lexeme_id_snapshot,
      ),
      datasetId: row.dataset_id,
      vocabEntryId: row.vocab_entry_id,
      canonicalLexemeId: row.canonical_lexeme_id_snapshot,
      sourceQuestionId: row.source_question_id,
      reasonLevel: row.reason_level,
      queuedAt: row.queued_at,
      reviewDraftId: row.reserved_review_draft_id,
    }),
  );
  if (eventRows.length === 0) {
    return {
      ...emptyStudentWrongWordHistory(),
      pendingReviewCount: pendingReviews.length,
      pendingReviews,
    };
  }

  const attemptIds = unique(
    eventRows.map((event) => event.quiz_attempt_id),
  );
  const questionIds = unique(
    eventRows.map((event) => event.quiz_question_id),
  );
  const vocabEntryIds = unique(
    eventRows.map((event) => event.vocab_entry_id),
  );
  const attemptRows: AttemptRow[] = [];
  const questionRows: QuestionRow[] = [];
  const entryRows: EntryRow[] = [];

  for (const idChunk of chunks(attemptIds)) {
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select(
        "id, attempt_number, status, completed_at, assignment:assignments(title)",
      )
      .in("id", idChunk);
    if (error) throw new Error("오답 시험 이력을 불러오지 못했습니다.");
    attemptRows.push(...((data ?? []) as AttemptRow[]));
  }

  for (const idChunk of chunks(questionIds)) {
    const { data, error } = await supabase
      .from("quiz_questions")
      .select(
        "id, vocab_entry_id, initial_is_correct, retry_is_correct, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(headword_snapshot, primary_meaning_snapshot, provenance_status)",
      )
      .in("id", idChunk);
    if (error) throw new Error("오답 문항 이력을 불러오지 못했습니다.");
    questionRows.push(...((data ?? []) as QuestionRow[]));
  }

  for (const idChunk of chunks(vocabEntryIds)) {
    const { data, error } = await supabase
      .from("vocab_entries")
      .select(
        "id, dataset_id, headword, primary_meaning, dataset:vocab_datasets(title, edition)",
      )
      .in("id", idChunk);
    if (error) throw new Error("오답 단어 정보를 불러오지 못했습니다.");
    entryRows.push(...((data ?? []) as EntryRow[]));
  }

  const entryById = new Map(entryRows.map((entry) => [entry.id, entry]));
  const attempts = attemptRows.flatMap(
    (attempt): WrongAttemptSource[] => {
      const assignment = oneRelation(attempt.assignment);
      if (!assignment || !attempt.completed_at) return [];
      return [
        {
          id: attempt.id,
          assignmentTitle: assignment.title,
          attemptNumber: attempt.attempt_number,
          status: attempt.status,
          completedAt: attempt.completed_at,
        },
      ];
    },
  );
  const entries = entryRows.map((entry): WrongEntrySource => {
    const dataset = oneRelation(entry.dataset);
    return {
      id: entry.id,
      datasetId: entry.dataset_id,
      datasetLabel:
        [dataset?.title, dataset?.edition].filter(Boolean).join(" · ") ||
        "단어장",
      headword: entry.headword,
      primaryMeaning: entry.primary_meaning,
    };
  });
  const questions = questionRows.flatMap(
    (question): WrongQuestionSource[] => {
      const entry = entryById.get(question.vocab_entry_id);
      if (!entry) return [];
      const snapshot = oneRelation(question.assignment_question);
      const verified = snapshot?.provenance_status === "verified_v2";
      return [
        {
          id: question.id,
          vocabEntryId: question.vocab_entry_id,
          initialIsCorrect: question.initial_is_correct,
          retryIsCorrect: question.retry_is_correct,
          headword:
            (verified ? snapshot.headword_snapshot : null) ??
            entry.headword,
          primaryMeaning:
            (verified ? snapshot.primary_meaning_snapshot : null) ??
            entry.primary_meaning,
          provenanceStatus:
            snapshot?.provenance_status ?? "legacy_backfill",
        },
      ];
    },
  );
  const events = eventRows.map(
    (event): WrongEventSource => ({
      attemptId: event.quiz_attempt_id,
      questionId: event.quiz_question_id,
      datasetId: event.dataset_id,
      vocabEntryId: event.vocab_entry_id,
      canonicalLexemeId: event.canonical_lexeme_id_snapshot,
      stage: event.wrong_stage,
      wrongAt: event.wrong_at,
    }),
  );

  return {
    ...buildStudentWrongWordHistory({
      attempts,
      entries,
      events,
      questions,
    }),
    pendingReviewCount: pendingReviews.length,
    pendingReviews,
  };
}

export async function queueStudentWrongWords(
  studentId: string,
  questionIds: string[],
  authenticatedAdmin?: AdminContext,
): Promise<string[]> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "queue_student_vocab_review_words",
    {
      p_student_id: studentId,
      p_question_ids: questionIds,
    },
  );

  if (error || !Array.isArray(data)) {
    console.error("[wrong-word-queue] database operation failed", {
      code: error?.code ?? "missing_result",
      message: error?.message ?? "queue ids were not returned",
      hint: error?.hint ?? null,
    });
    throw new WrongWordQueueError(
      error?.code === "42501"
        ? "forbidden"
        : ["22023", "P0002", "23503", "23505"].includes(
              error?.code ?? "",
            )
          ? "invalid_selection"
          : "database",
    );
  }

  if (
    data.length === 0 ||
    data.some((queueId) => typeof queueId !== "string")
  ) {
    throw new WrongWordQueueError("database");
  }

  return data as string[];
}

export async function createStudentReviewAssignmentDraft(
  studentId: string,
  questionIds: string[],
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_student_vocab_review_assignment_draft",
    {
      p_student_id: studentId,
      p_question_ids: questionIds,
    },
  );

  if (error) {
    console.error("[review-assignment-draft] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw new ReviewAssignmentDraftError(
      error.code === "42501"
        ? "forbidden"
        : error.code === "40001"
          ? "conflict"
          : ["22023", "P0002", "23503", "23505"].includes(
                error.code,
              )
            ? "invalid_selection"
            : "database",
    );
  }

  if (!z.uuid().safeParse(data).success) {
    throw new ReviewAssignmentDraftError("database");
  }

  return data as string;
}
