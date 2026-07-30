import "server-only";

import { normalizeQuizHeadword } from "@/lib/quiz/engine";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 100;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type AssignmentStudentRow = {
  assignment_id: string;
  student_id: string;
  assigned_at: string;
};

type AssignmentRow = {
  id: string;
  title: string;
};

type AttemptRow = {
  assignment_id: string;
  student_id: string;
  status: "in_progress" | "completed" | "expired";
};

type AssignmentQuestionRow = {
  assignment_id: string;
  vocab_entry_id: number;
  canonical_lexeme_id_snapshot: string | null;
  headword_normalized_snapshot: string | null;
};

export type ActiveAssignmentWord = {
  studentId: string;
  assignmentId: string;
  title: string;
  assignedAt: string;
  datasetId: string;
  vocabEntryId: number;
  canonicalLexemeId: string | null;
  headwordNormalized: string | null;
};

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function activeReviewIdentity(
  vocabEntryId: number,
  canonicalLexemeId: string | null | undefined,
  headwordNormalized?: string | null,
) {
  if (canonicalLexemeId) return `canonical:${canonicalLexemeId}`;
  const headwordKey = headwordNormalized
    ? normalizeQuizHeadword(headwordNormalized)
    : "";
  return headwordKey
    ? `headword:${headwordKey}`
    : `entry:${vocabEntryId}`;
}

/**
 * Loads every word held by an unstarted or in-progress assignment.
 *
 * `queueIds` remains available for the review-queue UI, while `identities`
 * and `words` are derived from the complete assignment question bank. This
 * prevents a regular DAY assignment from bypassing review-word locking.
 */
export async function loadActiveReviewAssignments(
  supabase: ServerSupabaseClient,
  studentIds: readonly string[],
  datasetId: string,
) {
  const queueIds = new Set<string>();
  const identities = new Set<string>();
  const words: ActiveAssignmentWord[] = [];
  const uniqueStudentIds = [...new Set(studentIds)];
  if (uniqueStudentIds.length === 0) {
    return { queueIds, identities, words };
  }

  for (const studentId of uniqueStudentIds) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("assignment_review_targets")
        .select("review_queue_id")
        .eq("student_id", studentId)
        .eq("dataset_id", datasetId)
        .is("released_at", null)
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error("배정 중인 오답 정보를 확인하지 못했습니다.");
      }
      for (const row of data ?? []) {
        queueIds.add(row.review_queue_id);
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
  }

  const linkRows: AssignmentStudentRow[] = [];
  for (const studentIdChunk of chunks(
    uniqueStudentIds,
    ID_CHUNK_SIZE,
  )) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("assignment_students")
        .select("assignment_id, student_id, assigned_at")
        .in("student_id", studentIdChunk)
        .is("cancelled_at", null)
        .is("missed_at", null)
        .order("assignment_id")
        .order("student_id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error("배정 중인 시험 단어를 확인하지 못했습니다.");
      }
      linkRows.push(...((data ?? []) as AssignmentStudentRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }

  const assignmentIds = [
    ...new Set(linkRows.map((row) => row.assignment_id)),
  ];
  if (assignmentIds.length === 0) {
    return { queueIds, identities, words };
  }

  const assignmentRows: AssignmentRow[] = [];
  const attemptRows: AttemptRow[] = [];
  for (const assignmentIdChunk of chunks(
    assignmentIds,
    ID_CHUNK_SIZE,
  )) {
    const [
      { data: assignmentData, error: assignmentError },
      { data: attemptData, error: attemptError },
    ] = await Promise.all([
      supabase
        .from("assignments")
        .select("id, title")
        .in("id", assignmentIdChunk)
        .eq("dataset_id", datasetId)
        .neq("status", "closed"),
      supabase
        .from("quiz_attempts")
        .select("assignment_id, student_id, status")
        .in("assignment_id", assignmentIdChunk)
        .in("student_id", uniqueStudentIds),
    ]);
    if (assignmentError || attemptError) {
      throw new Error("배정 중인 시험 단어를 확인하지 못했습니다.");
    }
    assignmentRows.push(...((assignmentData ?? []) as AssignmentRow[]));
    attemptRows.push(...((attemptData ?? []) as AttemptRow[]));
  }

  const assignmentById = new Map(
    assignmentRows.map((assignment) => [assignment.id, assignment]),
  );
  const attemptStatusesByLink = new Map<string, Set<AttemptRow["status"]>>();
  for (const attempt of attemptRows) {
    const key = `${attempt.assignment_id}:${attempt.student_id}`;
    const statuses = attemptStatusesByLink.get(key) ?? new Set();
    statuses.add(attempt.status);
    attemptStatusesByLink.set(key, statuses);
  }
  const activeLinks = linkRows.filter((link) => {
    if (!assignmentById.has(link.assignment_id)) return false;
    const statuses = attemptStatusesByLink.get(
      `${link.assignment_id}:${link.student_id}`,
    );
    return !statuses || statuses.has("in_progress");
  });
  const activeAssignmentIds = [
    ...new Set(activeLinks.map((link) => link.assignment_id)),
  ];

  const questionRows: AssignmentQuestionRow[] = [];
  for (const assignmentIdChunk of chunks(
    activeAssignmentIds,
    ID_CHUNK_SIZE,
  )) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("assignment_questions")
        .select(
          "assignment_id, vocab_entry_id, canonical_lexeme_id_snapshot, headword_normalized_snapshot",
        )
        .in("assignment_id", assignmentIdChunk)
        .eq("dataset_id", datasetId)
        .order("assignment_id")
        .order("base_order_index")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw new Error("배정 중인 시험 단어를 확인하지 못했습니다.");
      }
      questionRows.push(
        ...((data ?? []) as AssignmentQuestionRow[]),
      );
      if (!data || data.length < PAGE_SIZE) break;
    }
  }

  const questionsByAssignment = new Map<
    string,
    AssignmentQuestionRow[]
  >();
  for (const question of questionRows) {
    const current =
      questionsByAssignment.get(question.assignment_id) ?? [];
    current.push(question);
    questionsByAssignment.set(question.assignment_id, current);
  }

  for (const link of activeLinks) {
    const assignment = assignmentById.get(link.assignment_id);
    if (!assignment) continue;
    for (const question of
      questionsByAssignment.get(link.assignment_id) ?? []) {
      identities.add(
        activeReviewIdentity(
          question.vocab_entry_id,
          question.canonical_lexeme_id_snapshot,
          question.headword_normalized_snapshot,
        ),
      );
      words.push({
        studentId: link.student_id,
        assignmentId: link.assignment_id,
        title: assignment.title,
        assignedAt: link.assigned_at,
        datasetId,
        vocabEntryId: question.vocab_entry_id,
        canonicalLexemeId:
          question.canonical_lexeme_id_snapshot,
        headwordNormalized:
          question.headword_normalized_snapshot,
      });
    }
  }

  return { queueIds, identities, words };
}
