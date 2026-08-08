import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/ui-button";
import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";
import {
  formatElapsed,
  formatKoreanDateTime,
} from "@/lib/format";
import { getResultQuestionPresentation } from "@/lib/quiz/result-presentation";
import { getAdminAttemptDetail } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: adminHistoryText.resultDetail.metadataTitle,
};

function retryLabel(
  initialIsCorrect: boolean | null,
  retryIsCorrect: boolean | null,
  reviewPending: boolean,
) {
  const copy = adminHistoryText.resultDetail.status;
  if (initialIsCorrect === true) return copy.initialCorrect;
  if (retryIsCorrect === true) return copy.resolvedAfterRetry;
  if (retryIsCorrect === false) return copy.unresolved;
  if (reviewPending) return copy.retryPending;
  return copy.incomplete;
}

export default async function AdminResultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getAdminAttemptDetail(id);
  if (!result) notFound();
  const reviewPending =
    result.status === "in_progress" && result.phase === "review";

  const wrongQuestions = result.questions.filter(
    (question) => question.initialIsCorrect !== true,
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{adminHistoryText.resultDetail.eyebrow}</p>
          <h1>{result.studentName}</h1>
          <p>
            {result.assignmentTitle} ·{" "}
            {formatContentText(adminHistoryText.resultDetail.attemptNumber, {
              count: result.attemptNumber,
            })}{" "}
            ·{" "}
            {formatKoreanDateTime(result.startedAt)}
          </p>
        </div>
        <ButtonLink href="/admin/results" variant="quiet">
          {adminHistoryText.resultDetail.backToResults}
        </ButtonLink>
      </div>

      <div className="attempt-detail-layout">
        <aside
          aria-label={adminHistoryText.resultDetail.summaryAria}
          className="card attempt-summary"
        >
          <h2>{adminHistoryText.resultDetail.summaryTitle}</h2>
          <dl>
            <div>
              <dt>{adminHistoryText.resultDetail.initialScore}</dt>
              <dd>
                {result.initialScore === null
                  ? "-"
                  : formatContentText(adminHistoryText.resultDetail.score, {
                      score: result.initialScore,
                    })}
              </dd>
            </div>
            <div>
              <dt>{adminHistoryText.resultDetail.finalScore}</dt>
              <dd>
                {result.finalScore === null
                  ? "-"
                  : formatContentText(adminHistoryText.resultDetail.score, {
                      score: result.finalScore,
                    })}
              </dd>
            </div>
            <div>
              <dt>{adminHistoryText.resultDetail.unresolvedCount}</dt>
              <dd>
                {formatContentText(adminHistoryText.resultDetail.count, {
                  count: result.unresolvedWrongCount ?? "-",
                })}
              </dd>
            </div>
            <div>
              <dt>{adminHistoryText.resultDetail.elapsed}</dt>
              <dd>{formatElapsed(result.elapsedSeconds)}</dd>
            </div>
          </dl>
          <ButtonLink href="/admin/results" variant="quiet">
            {adminHistoryText.resultDetail.backToResultsLong}
          </ButtonLink>
        </aside>

        <section
          aria-labelledby="answer-flow-heading"
          className="attempt-flow-section"
        >
          <div className="section-heading">
            <h2 id="answer-flow-heading">
              {adminHistoryText.resultDetail.flowTitle}
            </h2>
            <span className="detail-chip">
              {formatContentText(
                adminHistoryText.resultDetail.questionCount,
                { count: wrongQuestions.length },
              )}
            </span>
          </div>

          {wrongQuestions.length === 0 ? (
            <div className="empty-state">
              {adminHistoryText.resultDetail.allCorrect}
            </div>
          ) : (
            <div className="attempt-flow-list">
              {wrongQuestions.map((question) => {
                const resolved = question.retryIsCorrect === true;
                const presentation =
                  getResultQuestionPresentation(question);

                return (
                  <article className="card attempt-flow-card" key={question.id}>
                    <div className="title-with-status">
                      <div>
                        <p className="eyebrow">
                          {formatContentText(
                            adminHistoryText.resultDetail.questionNumber,
                            { number: question.orderIndex },
                          )}
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
                        {retryLabel(
                          question.initialIsCorrect,
                          question.retryIsCorrect,
                          reviewPending,
                        )}
                      </span>
                    </div>

                    <div
                      className={`answer-flow${
                        resolved ? " answer-flow-resolved" : ""
                      }`}
                    >
                      <div className="flow-step flow-step-wrong">
                        <span>{adminHistoryText.resultDetail.initialChoice}</span>
                        <strong>
                          {question.initialChoice ??
                            adminHistoryText.resultDetail.noChoice}
                        </strong>
                      </div>
                      <span className="flow-arrow" aria-hidden="true">
                        →
                      </span>
                      <div
                        className={[
                          "flow-step",
                          resolved
                            ? "flow-step-correct"
                            : "flow-step-wrong",
                        ].join(" ")}
                      >
                        <span>{adminHistoryText.resultDetail.retry}</span>
                        <strong>
                          {question.retryChoice ??
                            (reviewPending
                              ? adminHistoryText.resultDetail.retryPending
                              : adminHistoryText.resultDetail.noChoice)}
                        </strong>
                        {resolved && (
                          <span className="sr-only">
                            {adminHistoryText.resultDetail.retryCorrectSr}
                          </span>
                        )}
                      </div>
                      {!resolved && (
                        <>
                          <span className="flow-arrow" aria-hidden="true">
                            →
                          </span>
                          <div className="flow-step flow-step-answer">
                            <span>{adminHistoryText.resultDetail.answer}</span>
                            <strong>{presentation.correctAnswer}</strong>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
