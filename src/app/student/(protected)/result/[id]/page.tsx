import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { studentAppText } from "@/content/ko/student-app";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { StudentResultView } from "@/features/results/ui/student-result-view";
import { requireStudentSession } from "@/lib/auth/student-session";
import { getAttemptResult } from "@/lib/services/quiz/attempt-result-query";

export const metadata: Metadata = {
  title: studentAppText.result.metadataTitle,
};

export default function StudentResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<RouteLoadingState label={studentAppText.login.loading} />}>
      <StudentResultContent params={params} />
    </Suspense>
  );
}

async function StudentResultContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session] = await Promise.all([
    params,
    requireStudentSession(),
  ]);
  const result = await getAttemptResult(session.studentId, id);

  if (!result) notFound();
  const reviewPending =
    result.status === "in_progress" && result.phase === "review";
  if (result.status === "in_progress" && !reviewPending) {
    redirect(`/student/attempt/${result.id}`);
  }

  return <StudentResultView result={result} />;
}
