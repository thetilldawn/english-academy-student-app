import "server-only";

import {
  emptyStudentWrongWordHistory,
  buildStudentWrongWordHistory,
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
import { getServiceSupabaseClient } from "@/lib/supabase/service";

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
  if (eventRows.length === 0) {
    return emptyStudentWrongWordHistory();
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

  return buildStudentWrongWordHistory({
    attempts,
    entries,
    events,
    questions,
  });
}
