import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { QuizPlayer } from "@/components/quiz-player";
import { studentAppText } from "@/content/ko/student-app";
import { requireStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  secondsUntil,
} from "@/lib/deadline";
import { getStudentAttempt } from "@/lib/services/quiz-service";

export const metadata: Metadata = {
  title: studentAppText.attempt.metadataTitle,
};

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session] = await Promise.all([
    params,
    requireStudentSession(),
  ]);
  const attempt = await getStudentAttempt(session.studentId, id);

  if (!attempt) notFound();
  if (
    attempt.status !== "in_progress" ||
    attempt.phase === "review" ||
    attempt.phase === "completed"
  ) {
    redirect(`/student/result/${attempt.id}`);
  }

  return (
    <main className="quiz-shell" id="main-content">
      <QuizPlayer
        initialAttempt={attempt}
        initialRemainingSeconds={
          secondsUntil(
            attempt.timerDeadlineAt,
            currentTimeMilliseconds(),
          ) ?? 0
        }
      />
    </main>
  );
}
