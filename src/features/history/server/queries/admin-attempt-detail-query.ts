import "server-only";

import type { AdminAttemptDetail } from "../../model";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { deriveAttemptQuestionMetrics } from "@/lib/quiz/result-presentation";
import { normalizeQuizContentMode } from "@/lib/quiz/question-content-mode";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { getAttemptQuestionResults } from "@/lib/services/quiz/attempt-result-query";
import { getVocabularyResultRecord } from "@/features/results/public-server";

export async function getAdminAttemptDetail(
  attemptId: string,
  authenticatedAdmin?: AdminContext,
): Promise<AdminAttemptDetail | null> {
  const admin = authenticatedAdmin ?? await requireAdmin();
  const supabase = getServiceSupabaseClient();
  const { data, error } = await
    supabase
      .from("quiz_attempts")
      .select(
        "id, attempt_number, status, phase, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, initial_completed_at, completed_at, students(display_name, deleted_at), assignments(title, deleted_at, quiz_content_mode)",
      )
      .eq("id", attemptId)
      .maybeSingle();

  if (error) {
    throw new Error("응시 상세를 불러오지 못했습니다.");
  }
  if (!data) {
    return null;
  }

  const resultRecord = await getVocabularyResultRecord(attemptId, { kind: "admin", id: admin.userId });
  if (!resultRecord) return null;
  const snapshot = resultRecord.attempt;
  const questions = await getAttemptQuestionResults(attemptId, { kind: "admin", adminId: admin.userId }, resultRecord.detailScope);
  const student = Array.isArray(data.students)
    ? data.students[0]
    : data.students;
  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;
  const reviewing = snapshot.status === "in_progress" && snapshot.phase === "review";
  const initial = resultRecord.phases.find(phase => phase.phase === "initial");
  const retry = resultRecord.phases.find(phase => phase.phase === "retry");
  const reviewMetrics = resultRecord.retentionPolicy === "summary_and_mistakes_v1" && initial
    ? { initialCorrectCount: initial.correctCount, retryCorrectCount: retry?.correctCount ?? snapshot.retryCorrectCount ?? 0,
      unresolvedWrongCount: retry ? initial.targetCount - initial.correctCount - retry.correctCount
        : snapshot.unresolvedWrongCount ?? initial.targetCount - initial.correctCount, initialScore: initial.score }
    : reviewing
    ? deriveAttemptQuestionMetrics(questions)
    : null;
  const reviewElapsedSeconds =
    reviewing && snapshot.initialCompletedAt
      ? Math.max(
          0,
          Math.floor(
            (new Date(snapshot.initialCompletedAt).getTime() -
              new Date(snapshot.startedAt).getTime()) /
              1000,
          ),
        )
      : null;

  return {
    resultRecord,
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
    attemptNumber: snapshot.attemptNumber,
    status: snapshot.status,
    phase: snapshot.phase,
    initialScore:
      reviewMetrics?.initialScore ??
      (snapshot.initialScore === null ? null : Number(snapshot.initialScore)),
    finalScore: snapshot.finalScore === null ? null : Number(snapshot.finalScore),
    passed: snapshot.passed,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    questionCount: snapshot.questionCount,
    initialCorrectCount:
      reviewMetrics?.initialCorrectCount ?? snapshot.initialCorrectCount,
    retryCorrectCount:
      reviewMetrics?.retryCorrectCount ?? snapshot.retryCorrectCount,
    unresolvedWrongCount:
      reviewMetrics?.unresolvedWrongCount ?? snapshot.unresolvedWrongCount,
    elapsedSeconds: reviewElapsedSeconds ?? snapshot.elapsedSeconds,
    quizContentMode: normalizeQuizContentMode(
      assignment?.quiz_content_mode ?? "legacy_book_meaning_choice",
    ),
    questions,
  };
}
