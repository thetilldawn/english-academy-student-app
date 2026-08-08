import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { StartRetryButton } from "@/components/start-retry-button";
import { ButtonLink } from "@/components/ui-button";
import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { requireStudentSession } from "@/lib/auth/student-session";
import { formatElapsed } from "@/lib/format";
import { getResultQuestionPresentation } from "@/lib/quiz/result-presentation";
import { getAttemptResult } from "@/lib/services/quiz-service";

export const metadata: Metadata = {
  title: studentAppText.result.metadataTitle,
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
          <p className="eyebrow">
            {formatContentText(studentAppText.result.question.number, {
              number: question.orderIndex,
            })}
          </p>
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
            ? studentAppText.result.question.retryCorrect
            : question.retryIsCorrect === false
              ? studentAppText.result.question.retryWrong
              : reviewPending
                ? studentAppText.result.question.retryPending
                : studentAppText.result.question.incomplete}
        </span>
      </div>
      <dl className="answer-detail answer-detail-3">
        <div>
          <dt>{studentAppText.result.question.initialChoice}</dt>
          <dd>
            {question.initialChoice ?? studentAppText.result.question.noChoice}
          </dd>
        </div>
        <div>
          <dt>{studentAppText.result.question.retry}</dt>
          <dd>
            {question.retryChoice ??
              (reviewPending
                ? studentAppText.result.question.retryPending
                : studentAppText.result.question.noChoice)}
          </dd>
        </div>
        <div>
          <dt>{studentAppText.result.question.answer}</dt>
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
              ? studentAppText.result.eyebrow.reviewPending
              : expired
                ? studentAppText.result.eyebrow.expired
                : result.passed
                  ? studentAppText.result.eyebrow.passed
                  : studentAppText.result.eyebrow.completed}
          </p>
          <h1>{result.title}</h1>
          <p>
            {reviewPending
              ? studentAppText.result.message.retryReady
              : expired
              ? studentAppText.result.message.expired
              : result.passed
                ? studentAppText.result.message.passed
                : studentAppText.result.message.failed}
          </p>
        </div>
        <strong>
          {result.initialScore === null
            ? "-"
            : formatContentText(studentAppText.result.score, {
                score: result.initialScore,
              })}
        </strong>
      </section>

      <div className="student-result-layout section">
        <section
          aria-labelledby="unresolved-heading"
          className="result-review"
        >
          <div className="section-heading">
            <h2 id="unresolved-heading">
              {reviewPending
                ? studentAppText.result.sections.firstWrong
                : studentAppText.result.sections.unresolved}
            </h2>
            <span className="detail-chip">
              {formatContentText(studentAppText.result.count, {
                count: unresolvedQuestions.length,
              })}
            </span>
          </div>
          {unresolvedQuestions.length === 0 ? (
            <div className="empty-state">
              {reviewPending
                ? studentAppText.result.empty.noInitialWrong
                : studentAppText.result.empty.noUnresolved}
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

        <aside
          aria-label={studentAppText.result.summary.aria}
          className="result-sidebar"
        >
          <section className="card result-metric-list">
            <div>
              <span>{studentAppText.result.summary.initialCorrect}</span>
              <strong>
                {result.initialCorrectCount ?? "-"}
                <small>/{result.questionCount}</small>
              </strong>
            </div>
            <div>
              <span>{studentAppText.result.summary.retryCorrect}</span>
              <strong>
                {reviewPending ? "-" : (result.retryCorrectCount ?? "-")}
              </strong>
            </div>
            <div>
              <span>
                {reviewPending
                  ? studentAppText.result.summary.retryTarget
                  : studentAppText.result.summary.unresolved}
              </span>
              <strong>{result.unresolvedWrongCount ?? "-"}</strong>
            </div>
          </section>

          <section className="card result-summary result-summary-stacked">
            <div>
              <span>{studentAppText.result.summary.finalScore}</span>
              <strong>
                {reviewPending || result.finalScore === null
                  ? "-"
                  : formatContentText(studentAppText.result.score, {
                      score: result.finalScore,
                    })}
              </strong>
            </div>
            <div>
              <span>{studentAppText.result.summary.elapsed}</span>
              <strong>{formatElapsed(result.elapsedSeconds)}</strong>
            </div>
            <div>
              <span>{studentAppText.result.summary.attemptNumber}</span>
              <strong>
                {formatContentText(studentAppText.result.attemptCount, {
                  count: result.attemptNumber,
                })}
              </strong>
            </div>
          </section>

          {reviewPending && <StartRetryButton attemptId={result.id} />}
          <ButtonLink
            href="/student"
            variant={reviewPending ? "quiet" : "primary"}
          >
            {studentAppText.result.backToAssignments}
          </ButtonLink>
        </aside>
      </div>

      {resolvedQuestions.length > 0 && (
        <section aria-labelledby="resolved-heading" className="section">
          <div className="section-heading">
            <h2 id="resolved-heading">
              {studentAppText.result.sections.resolved}
            </h2>
            <span className="detail-chip">
              {formatContentText(studentAppText.result.count, {
                count: resolvedQuestions.length,
              })}
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
