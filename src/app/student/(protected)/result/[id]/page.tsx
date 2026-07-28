import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireStudentSession } from "@/lib/auth/student-session";
import { formatElapsed } from "@/lib/format";
import { getAttemptResult } from "@/lib/services/quiz-service";

export const metadata: Metadata = {
  title: "시험 결과",
};

type ResultQuestion = NonNullable<
  Awaited<ReturnType<typeof getAttemptResult>>
>["questions"][number];

function QuestionReviewCard({
  question,
}: {
  question: ResultQuestion;
}) {
  const resolved = question.retryIsCorrect === true;

  return (
    <article className="card result-question">
      <div className="title-with-status">
        <div>
          <p className="eyebrow">문항 {question.orderIndex}</p>
          <h3>{question.headword || question.prompt}</h3>
        </div>
        <span
          className={`status-pill ${
            resolved ? "status-completed" : "status-expired"
          }`}
        >
          {resolved
            ? "다시 맞힘"
            : question.retryIsCorrect === false
              ? "다시 틀림"
              : "미완료"}
        </span>
      </div>
      <dl className="answer-detail answer-detail-3">
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
  );
}

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
  const unresolvedQuestions = wrongQuestions.filter(
    (question) => question.retryIsCorrect !== true,
  );
  const resolvedQuestions = wrongQuestions.filter(
    (question) => question.retryIsCorrect === true,
  );

  return (
    <main
      className="content student-content result-page"
      id="main-content"
    >
      <section
        className={[
          "student-result-header",
          expired ? "student-result-expired" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div>
          <p className="eyebrow">
            {expired ? "TIME ENDED" : result.passed ? "PASSED" : "COMPLETED"}
          </p>
          <h1>{result.title}</h1>
          <p>
            {expired
              ? "제한시간이 끝났습니다."
              : result.passed
                ? "통과했습니다."
                : "통과점수에는 미치지 못했습니다."}
          </p>
        </div>
        <strong>
          {result.initialScore === null ? "-" : `${result.initialScore}점`}
        </strong>
      </section>

      <div className="student-result-layout section">
        <section
          aria-labelledby="unresolved-heading"
          className="result-review"
        >
          <div className="section-heading">
            <h2 id="unresolved-heading">다시 볼 단어</h2>
            <span className="detail-chip">
              {unresolvedQuestions.length}개
            </span>
          </div>
          {unresolvedQuestions.length === 0 ? (
            <div className="empty-state">
              다시 확인할 단어가 남지 않았습니다.
            </div>
          ) : (
            <div className="result-question-list">
              {unresolvedQuestions.map((question) => (
                <QuestionReviewCard
                  key={question.id}
                  question={question}
                />
              ))}
            </div>
          )}
        </section>

        <aside aria-label="시험 결과 요약" className="result-sidebar">
          <section className="card result-metric-list">
            <div>
              <span>첫 풀이 정답</span>
              <strong>
                {result.initialCorrectCount ?? "-"}
                <small>/{result.questionCount}</small>
              </strong>
            </div>
            <div>
              <span>다시 맞힌 단어</span>
              <strong>{result.retryCorrectCount ?? "-"}</strong>
            </div>
            <div>
              <span>다시 볼 단어</span>
              <strong>{result.unresolvedWrongCount ?? "-"}</strong>
            </div>
          </section>

          <section className="card result-summary result-summary-stacked">
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

          <Link className="button button-primary" href="/student">
            내 시험으로 돌아가기
          </Link>
        </aside>
      </div>

      {resolvedQuestions.length > 0 && (
        <section aria-labelledby="resolved-heading" className="section">
          <div className="section-heading">
            <h2 id="resolved-heading">다시 맞힌 단어</h2>
            <span className="detail-chip">
              {resolvedQuestions.length}개
            </span>
          </div>
          <div className="result-question-list result-question-grid">
            {resolvedQuestions.map((question) => (
              <QuestionReviewCard key={question.id} question={question} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
