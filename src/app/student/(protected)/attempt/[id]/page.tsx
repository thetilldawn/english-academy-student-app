import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { studentAppText } from "@/content/ko/student-app";
import { PanelLoadFailure, RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { QuizPlayer } from "@/features/quiz-player/ui/quiz-player";
import { requireStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  millisecondsUntil,
} from "@/lib/deadline";
import { getStudentAttempt } from "@/lib/services/quiz/attempt-query";
import { getQuizPreparation, getRetryPreparation, QuizPreparationChangedError } from "@/features/quiz-player/public-server";
import { PreparedQuizPlayer } from "@/features/quiz-player/ui/prepared-quiz-player";

export const metadata: Metadata = {
  title: studentAppText.attempt.metadataTitle,
};

export default function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prepare?: string }>;
}) {
  return (
    <Suspense fallback={<RouteLoadingState label="시험 준비 중" />}>
      <AttemptContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AttemptContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prepare?: string }>;
}) {
  const [{ id }, session] = await Promise.all([
    params,
    requireStudentSession(),
  ]);
  const attempt = await getStudentAttempt(session.studentId, id);

  if (!attempt) {
    let prepared: Awaited<ReturnType<typeof getQuizPreparation>>;
    try { prepared = await getQuizPreparation(session.studentId,id); }
    catch (error) {
      if (!(error instanceof QuizPreparationChangedError)) throw error;
      return <main id="main-content"><PanelLoadFailure message={studentAppText.attempt.preparationChanged} retryHref="/student" retryLabel={studentAppText.attempt.backToList} /></main>;
    }
    if (!prepared || prepared.kind !== "initial") notFound();
    if ("resumeId" in prepared) redirect(`/student/attempt/${prepared.resumeId}`);
    return <PreparedQuizPlayer key={prepared.id} preparation={prepared} />;
  }
  if ((await searchParams).prepare === "retry" && attempt.phase === "review") {
    const prepared = await getRetryPreparation(session.studentId,id,attempt);
    if (prepared) return <PreparedQuizPlayer key={prepared.id+":retry"} preparation={prepared} />;
  }
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
