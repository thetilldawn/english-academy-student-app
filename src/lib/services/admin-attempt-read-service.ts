import "server-only";

import { deriveAttemptQuestionMetrics } from "@/lib/quiz/result-presentation";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import type {
  AdminAttemptDetail,
  AttemptSummary,
} from "@/features/history/model";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { getAttemptQuestionResults } from "./quiz/attempt-result-query";

export async function listAttempts(): Promise<AttemptSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, attempt_number, status, phase, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, started_at, completed_at, students(display_name, deleted_at), assignments(title, deleted_at)",
    )
    .order("started_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error("시험 결과를 불러오지 못했습니다.");
  }

  return (data ?? []).map((attempt) => {
    const student = Array.isArray(attempt.students)
      ? attempt.students[0]
      : attempt.students;
    const assignment = Array.isArray(attempt.assignments)
      ? attempt.assignments[0]
      : attempt.assignments;

    return {
      id: attempt.id,
      studentName:
        !student
          ? "알 수 없음"
          : student.deleted_at === null
            ? student.display_name
            : "삭제됨",
      assignmentTitle:
        !assignment
          ? "알 수 없음"
          : assignment.deleted_at === null
            ? assignment.title
            : "삭제됨",
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      phase: attempt.phase,
      initialScore:
        attempt.initial_score === null ? null : Number(attempt.initial_score),
      finalScore:
        attempt.final_score === null ? null : Number(attempt.final_score),
      passed: attempt.passed,
      questionCount: attempt.question_count_snapshot,
      initialCorrectCount: attempt.initial_correct_count,
      retryCorrectCount: attempt.retry_correct_count,
      unresolvedWrongCount: attempt.unresolved_wrong_count,
      startedAt: attempt.started_at,
      completedAt: attempt.completed_at,
    };
  });
}

export async function getAdminAttemptDetail(
  attemptId: string,
  authenticatedAdmin?: AdminContext,
): Promise<AdminAttemptDetail | null> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = getServiceSupabaseClient();
  const [{ data, error }, questions] = await Promise.all([
    supabase
      .from("quiz_attempts")
      .select(
        "id, attempt_number, status, phase, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, initial_completed_at, completed_at, students(display_name, deleted_at), assignments(title, deleted_at)",
      )
      .eq("id", attemptId)
      .maybeSingle(),
    getAttemptQuestionResults(attemptId),
  ]);

  if (error || !data) {
    return null;
  }

  const student = Array.isArray(data.students)
    ? data.students[0]
    : data.students;
  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;
  const reviewing =
    data.status === "in_progress" && data.phase === "review";
  const reviewMetrics = reviewing
    ? deriveAttemptQuestionMetrics(questions)
    : null;
  const reviewElapsedSeconds =
    reviewing && data.initial_completed_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(data.initial_completed_at).getTime() -
              new Date(data.started_at).getTime()) /
              1000,
          ),
        )
      : null;

  return {
    id: data.id,
    studentName:
      !student
        ? "알 수 없음"
        : student.deleted_at === null
          ? student.display_name
          : "삭제됨",
    assignmentTitle:
      !assignment
        ? "알 수 없음"
        : assignment.deleted_at === null
          ? assignment.title
          : "삭제됨",
    attemptNumber: data.attempt_number,
    status: data.status,
    phase: data.phase,
    initialScore:
      reviewMetrics?.initialScore ??
      (data.initial_score === null ? null : Number(data.initial_score)),
    finalScore: data.final_score === null ? null : Number(data.final_score),
    passed: data.passed,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    questionCount: data.question_count_snapshot,
    initialCorrectCount:
      reviewMetrics?.initialCorrectCount ?? data.initial_correct_count,
    retryCorrectCount:
      reviewMetrics?.retryCorrectCount ?? data.retry_correct_count,
    unresolvedWrongCount:
      reviewMetrics?.unresolvedWrongCount ??
      data.unresolved_wrong_count,
    elapsedSeconds: reviewElapsedSeconds ?? data.elapsed_seconds,
    questions,
  };
}
