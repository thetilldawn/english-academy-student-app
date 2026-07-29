import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { StartRetryButton } from "@/components/start-retry-button";
import { requireStudentSession } from "@/lib/auth/student-session";
import { formatElapsed } from "@/lib/format";
import { getResultQuestionPresentation } from "@/lib/quiz/result-presentation";
import { getAttemptResult } from "@/lib/services/quiz-service";

export const metadata: Metadata = {
  title: "시험 결과",
};

type ResultQuestion = NonNullable<
  Awaited<ReturnType<typeof getAttemptResult>>
>["questions"][number];

function QuestionReviewCard({
  question,
  reviewPending,
}: {
  question: ResultQuestion;
  reviewPending: boolean;
}) {
  const resolved = question.retryIsCorrect === true;
  const presentation = getResultQuestionPresentation(question);

  return (
    <article className="card result-question">
      <div className="title-with-status">
        <div>
          <p className="eyebrow">문항 {question.orderIndex}</p>
          <h3>{presentation.prompt}</h3>
        </div>
        <span
          className={`status-pill ${
            resolved
              ? "status-completed"
              : reviewPending
                ? "status-in_progress"
                : "status-expired"
          }`}
        >
          {resolved
            ? "다시 맞힘"
            : question.retryIsCorrect === false
              ? "다시 틀림"
              : reviewPending
                ? "재시험 전"
                : "미완료"}
        </span>
      </div>
      <dl className="answer-detail answer-detail-3">
        <div>
          <dt>첫 선택</dt>
          <dd>{question.initialChoice ?? "선택 안 함"}</dd>
        </div>
        <div>
          <dt>재시험</dt>
          <dd>
            {question.retryChoice ??
              (reviewPending ? "재시험 전" : "선택 안 함")}
          </dd>
        </div>
        <div>
          <dt>정답</dt>
          <dd>{presentation.correctAnswer}</dd>
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
  const reviewPending =
    result.status === "in_progress" && result.phase === "review";
  if (result.status === "in_progress" && !reviewPending) {
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
            {reviewPending
              ? "FIRST TEST RESULT"
              : expired
                ? "TIME ENDED"
                : result.passed
                  ? "PASSED"
                  : "COMPLETED"}
          </p>
          <h1>{result.title}</h1>
          <p>
            {reviewPending
              ? "틀린 단어를 확인한 뒤 재시험을 시작할 수 있습니다."
              : expired
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
            <h2 id="unresolved-heading">
              {reviewPending ? "한 번 틀린 단어" : "다시 볼 단어"}
            </h2>
            <span className="detail-chip">
              {unresolvedQuestions.length}개
            </span>
          </div>
          {unresolvedQuestions.length === 0 ? (
            <div className="empty-state">
              {reviewPending
                ? "첫 시험에서 틀린 단어가 없습니다."
                : "다시 확인할 단어가 남지 않았습니다."}
            </div>
          ) : (
            <div className="result-question-list">
              {unresolvedQuestions.map((question) => (
                <QuestionReviewCard
                  key={question.id}
                  question={question}
                  reviewPending={reviewPending}
                />
              ))}
            </div>
          )}
        </section>

        <aside aria-label="시험 결과 요약" className="result-sidebar">
          <section className="card result-metric-list">
            <div>
              <span>첫 시험 정답</span>
              <strong>
                {result.initialCorrectCount ?? "-"}
                <small>/{result.questionCount}</small>
              </strong>
            </div>
            <div>
              <span>재시험 정답</span>
              <strong>
                {reviewPending ? "-" : (result.retryCorrectCount ?? "-")}
              </strong>
            </div>
            <div>
              <span>
                {reviewPending ? "재시험 대상 단어" : "다시 볼 단어"}
              </span>
              <strong>{result.unresolvedWrongCount ?? "-"}</strong>
            </div>
          </section>

          <section className="card result-summary result-summary-stacked">
            <div>
              <span>재시험 후 점수</span>
              <strong>
                {reviewPending || result.finalScore === null
                  ? "-"
                  : `${result.finalScore}점`}
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

          {reviewPending && <StartRetryButton attemptId={result.id} />}
          <Link
            className={`button ${
              reviewPending ? "button-quiet" : "button-primary"
            }`}
            href="/student"
          >
            내 시험으로 돌아가기
          </Link>
        </aside>
      </div>

      {resolvedQuestions.length > 0 && (
        <section aria-labelledby="resolved-heading" className="section">
          <div className="section-heading">
            <h2 id="resolved-heading">한 번 틀린 단어</h2>
            <span className="detail-chip">
              {resolvedQuestions.length}개
            </span>
          </div>
          <div className="result-question-list result-question-grid">
            {resolvedQuestions.map((question) => (
              <QuestionReviewCard
                key={question.id}
                question={question}
                reviewPending={false}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
