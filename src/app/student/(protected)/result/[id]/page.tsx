import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireStudentSession } from "@/lib/auth/student-session";
import { formatElapsed } from "@/lib/format";
import { getAttemptResult } from "@/lib/services/quiz-service";

export const metadata: Metadata = {
  title: "시험 결과",
};

export default async function StudentResultPage({
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
  if (result.status === "in_progress") {
    redirect(`/student/attempt/${result.id}`);
  }

  const expired = result.status === "expired";
  const wrongQuestions = result.questions.filter(
    (question) => question.initialIsCorrect !== true,
  );

  return (
    <main className="content student-content result-page">
      <section className={`result-hero ${expired ? "result-expired" : ""}`}>
        <p className="eyebrow">
          {expired ? "TIME ENDED" : result.passed ? "PASSED" : "COMPLETED"}
        </p>
        <h1>{result.title}</h1>
        <strong>
          {result.initialScore === null ? "-" : `${result.initialScore}점`}
        </strong>
        <p>
          {expired
            ? "제한시간이 끝났습니다."
            : result.passed
              ? "통과했습니다."
              : "통과점수에는 미치지 못했습니다."}
        </p>
      </section>

      <section className="section grid grid-3">
        <article className="card metric">
          <span className="metric-value">
            {result.initialCorrectCount ?? "-"}
            <small>/{result.questionCount}</small>
          </span>
          <span className="metric-label">첫 풀이 정답</span>
        </article>
        <article className="card metric">
          <span className="metric-value">
            {result.retryCorrectCount ?? "-"}
          </span>
          <span className="metric-label">다시 풀어 맞힌 단어</span>
        </article>
        <article className="card metric">
          <span className="metric-value">
            {result.unresolvedWrongCount ?? "-"}
          </span>
          <span className="metric-label">다시 볼 단어</span>
        </article>
      </section>

      <section className="section card result-summary">
        <div>
          <span>재풀이 후 점수</span>
          <strong>
            {result.finalScore === null ? "-" : `${result.finalScore}점`}
          </strong>
        </div>
        <div>
          <span>응시 시간</span>
          <strong>{formatElapsed(result.elapsedSeconds)}</strong>
        </div>
        <div>
          <span>응시 회차</span>
          <strong>{result.attemptNumber}회</strong>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>오답과 재풀이</h2>
          <span className="detail-chip">{wrongQuestions.length}문항</span>
        </div>
        {wrongQuestions.length === 0 ? (
          <div className="empty-state">
            첫 풀이에서 모두 맞혔습니다.
          </div>
        ) : (
          <div className="result-question-list">
            {wrongQuestions.map((question) => (
              <article className="card result-question" key={question.id}>
                <div className="title-with-status">
                  <div>
                    <p className="eyebrow">문항 {question.orderIndex}</p>
                    <h3>{question.headword || question.prompt}</h3>
                  </div>
                  <span
                    className={`status-pill ${
                      question.retryIsCorrect
                        ? "status-completed"
                        : "status-expired"
                    }`}
                  >
                    {question.retryIsCorrect
                      ? "다시 맞힘"
                      : question.retryIsCorrect === false
                        ? "다시 틀림"
                        : "미완료"}
                  </span>
                </div>
                <dl className="answer-detail">
                  <div>
                    <dt>첫 선택</dt>
                    <dd>{question.initialChoice ?? "선택 안 함"}</dd>
                  </div>
                  <div>
                    <dt>재풀이</dt>
                    <dd>{question.retryChoice ?? "선택 안 함"}</dd>
                  </div>
                  <div>
                    <dt>정답</dt>
                    <dd>{question.correctAnswer}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="section inline-actions">
        <Link className="button button-primary" href="/student">
          내 시험으로 돌아가기
        </Link>
      </div>
    </main>
  );
}
