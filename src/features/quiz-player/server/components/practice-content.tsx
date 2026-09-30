import "server-only";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireStudentSession } from "@/lib/auth/student-session";
import { ButtonLink } from "@/design-system/primitives/button/button";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { getPractice, getPracticeHistory } from "../practice-service";
import { PracticeHistory } from "../../client/practice-history";
import { PracticePlayer } from "../../client/practice-player";
import styles from "../../ui/practice.module.css";

export function PracticeContent(props: { params?: Promise<{ id: string }>; result?: boolean }) {
  return <Suspense fallback={<RouteLoadingState label="연습을 불러오는 중입니다." />}><Content {...props} /></Suspense>;
}
async function Content({ params, result }: { params?: Promise<{ id: string }>; result?: boolean }) {
  const session = await requireStudentSession();
  if (!params) {
    const initial = await getPracticeHistory(session.studentId);
    return <main id="main-content" className={styles.page}><header className={styles.heading}><h1>연습 내역</h1><ButtonLink href="/student/wordbook">내 단어장</ButtonLink></header><PracticeHistory initial={initial} /></main>;
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const initial = await getPractice(session.studentId, id);
  if (!initial) notFound();
  const attempt = initial.attempt;
  if (!result) {
    if (attempt.status !== "in_progress") redirect(`/student/practice/${id}/result`);
    return <PracticePlayer initial={initial} />;
  }
  if (attempt.status === "in_progress") redirect(`/student/practice/${id}`);
  const correct = attempt.questions.filter(q => q.initialIsCorrect).length;
  return <main id="main-content" className={styles.page}><header className={styles.heading}><h1>연습 결과</h1><ButtonLink href="/student/practice">연습 내역</ButtonLink></header>
    <p>{attempt.questions.length}문항 중 {correct}개 정답{attempt.status === "expired" ? " · 시간 종료" : ""}</p>
    <div className={styles.actions}><ButtonLink href="/student/wordbook" prefetch={false}>다시 연습</ButtonLink></div>
    <ol className={styles.result}>{attempt.questions.map(q => <li key={q.id}><strong>{q.prompt}</strong><p>{q.initialTimedOut || q.initialChoiceIndex === null ? "미응답" : `내 답: ${q.choices[q.initialChoiceIndex]}`}</p>
      <p className={styles.correct}>정답: {q.revealedCorrectChoiceIndex === null ? "확인 중" : q.choices[q.revealedCorrectChoiceIndex]}</p></li>)}</ol>
  </main>;
}
