import "server-only";

import type { AssignmentPurpose } from "@/lib/admin/history";
import type { QuestionOrderMode, TimingMode } from "@/lib/admin/assignment-settings";
import { createQuizQuestions } from "@/lib/quiz/question-generator";
import type { QuizVocabularyEntry } from "@/lib/quiz/question-types";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

type AssignmentRow = {
  id: string;
  title: string;
  assignment_purpose: AssignmentPurpose;
  dataset_id: string;
  range_start: number;
  range_end: number;
  question_count: number;
  english_to_korean_ratio: number;
  time_limit_seconds: number;
  passing_score: number;
  retake_allowed: boolean;
  range_basis: "source_rows" | "units";
  question_bank_version: number | null;
  question_order_mode: QuestionOrderMode;
  timing_mode: TimingMode;
  question_time_limit_seconds: number | null;
  status: "draft" | "active" | "closed";
  available_from: string | null;
  available_until: string | null;
};

type ExistingAttemptRow = {
  id: string;
  phase: "initial" | "review" | "retry" | "completed";
  deadline_at: string;
};

export function reusableInProgressAttemptId(
  attempt: ExistingAttemptRow | null,
  evaluatedAtMilliseconds = Date.now(),
) {
  if (!attempt) return null;
  if (attempt.phase === "review") return attempt.id;
  if (attempt.phase !== "initial" && attempt.phase !== "retry") return null;
  if (attempt.deadline_at === "infinity") return attempt.id;
  const deadlineMilliseconds = Date.parse(attempt.deadline_at);
  return Number.isFinite(deadlineMilliseconds) &&
    deadlineMilliseconds > evaluatedAtMilliseconds
    ? attempt.id
    : null;
}

export async function startStudentAttempt(
  studentId: string,
  assignmentId: string,
): Promise<string> {
  const supabase = getServiceSupabaseClient();
  const [{ data: assignmentData, error: assignmentError }, { data: linkData }] =
    await Promise.all([
      supabase
        .from("assignments")
        .select(
          "id, title, assignment_purpose, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, timing_mode, question_time_limit_seconds, passing_score, retake_allowed, range_basis, question_bank_version, question_order_mode, status, available_from, available_until",
        )
        .eq("id", assignmentId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("assignment_students")
        .select("assignment_id, missed_at, cancelled_at")
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentId)
        .maybeSingle(),
    ]);
  const assignment = assignmentData as AssignmentRow | null;

  if (
    assignmentError ||
    !assignment ||
    !linkData ||
    linkData.missed_at !== null ||
    linkData.cancelled_at !== null
  ) {
    throw new Error("배정된 시험을 찾지 못했습니다.");
  }

  const { data: existingAttempt, error: existingAttemptError } =
    await supabase
      .from("quiz_attempts")
      .select("id, phase, deadline_at")
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId)
      .eq("status", "in_progress")
      .maybeSingle();
  if (existingAttemptError) {
    throw new Error("진행 중인 시험을 확인하지 못했습니다.");
  }
  const reusableAttemptId = reusableInProgressAttemptId(
    existingAttempt as ExistingAttemptRow | null,
  );
  if (reusableAttemptId) return reusableAttemptId;

  if (existingAttempt) {
    const { data: finalized, error: finalizeError } = await supabase.rpc(
      "finalize_quiz_attempt_if_stale",
      { p_attempt_id: existingAttempt.id },
    );
    if (finalizeError) {
      throw new Error("만료된 시험을 정리하지 못했습니다.");
    }
    if (!finalized) {
      const { data: currentAttempt, error: currentAttemptError } =
        await supabase
          .from("quiz_attempts")
          .select("id")
          .eq("student_id", studentId)
          .eq("assignment_id", assignmentId)
          .eq("status", "in_progress")
          .maybeSingle();
      if (currentAttemptError) {
        throw new Error("진행 중인 시험을 다시 확인하지 못했습니다.");
      }
      if (currentAttempt?.id) return currentAttempt.id;
    }
  }

  if (
    assignment.range_basis === "units" &&
    assignment.question_bank_version !== null
  ) {
    const { data, error } = await supabase.rpc(
      "create_quiz_attempt_from_bank",
      {
        p_student_id: studentId,
        p_assignment_id: assignmentId,
      },
    );

    if (error || typeof data !== "string") {
      const { data: recoveredAttempt } = await supabase
        .from("quiz_attempts")
        .select("id, phase, deadline_at")
        .eq("student_id", studentId)
        .eq("assignment_id", assignmentId)
        .eq("status", "in_progress")
        .maybeSingle();
      const recoveredAttemptId = reusableInProgressAttemptId(
        recoveredAttempt as ExistingAttemptRow | null,
      );
      if (recoveredAttemptId) return recoveredAttemptId;
      throw new Error("시험을 시작하지 못했습니다.");
    }

    return data;
  }

  const entryData: Array<{
    id: number;
    source_row: number;
    headword: string;
    headword_normalized: string;
    primary_meaning: string;
  }> = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data: page, error: entryError } = await supabase
      .from("vocab_entries")
      .select(
        "id, source_row, headword, headword_normalized, primary_meaning",
      )
      .eq("dataset_id", assignment.dataset_id)
      .gte("source_row", assignment.range_start)
      .lte("source_row", assignment.range_end)
      .order("source_row")
      .range(offset, offset + pageSize - 1);

    if (entryError) {
      throw new Error("시험 어휘를 불러오지 못했습니다.");
    }

    entryData.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
    offset += pageSize;
  }

  const uniqueEntries = new Map<string, QuizVocabularyEntry>();
  for (const entry of entryData) {
    const key = entry.headword_normalized.normalize("NFC").toLocaleLowerCase(
      "en-US",
    );
    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, {
        id: entry.id,
        headword: entry.headword,
        primaryMeaning: entry.primary_meaning,
      });
    }
  }

  const questions = createQuizQuestions(
    [...uniqueEntries.values()],
    assignment.question_count,
    assignment.english_to_korean_ratio,
  );
  const { data, error } = await supabase.rpc("create_quiz_attempt", {
    p_student_id: studentId,
    p_assignment_id: assignmentId,
    p_questions: questions.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      order_index: index + 1,
      direction: question.direction,
      prompt: question.prompt,
      choices: question.choices,
      correct_choice_index: question.correctChoiceIndex,
    })),
  });

  if (error || typeof data !== "string") {
    const { data: recoveredAttempt } = await supabase
      .from("quiz_attempts")
      .select("id, phase, deadline_at")
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId)
      .eq("status", "in_progress")
      .maybeSingle();
    const recoveredAttemptId = reusableInProgressAttemptId(
      recoveredAttempt as ExistingAttemptRow | null,
    );
    if (recoveredAttemptId) return recoveredAttemptId;
    throw new Error("시험을 시작하지 못했습니다.");
  }

  return data;
}
