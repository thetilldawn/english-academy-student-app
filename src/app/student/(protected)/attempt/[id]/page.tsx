import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { studentAppText } from "@/content/ko/student-app";
import { QuizPlayer } from "@/features/quiz-player/ui/quiz-player";
import { requireStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  millisecondsUntil,
} from "@/lib/deadline";
import { getStudentAttempt } from "@/lib/services/quiz/attempt-query";

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
    <QuizPlayer
      initialAttempt={attempt}
      initialRemainingMilliseconds={
        millisecondsUntil(
          attempt.timerDeadlineAt,
          currentTimeMilliseconds(),
        ) ?? 0
      }
    />
  );
}
