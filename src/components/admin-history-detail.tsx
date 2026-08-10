import type { ReactNode } from "react";

import { ActivityStatusTimeline } from "@/components/activity-status-timeline";
import { AssignmentMetaTags } from "@/components/assignment-meta-tags";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import {
  CountBadge,
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";
import {
  assignmentDisplayTitle,
  assignmentOrderLabel,
  assignmentScopeLabel,
} from "@/lib/admin/history";
import { formatElapsed, formatKoreanDateTime } from "@/lib/format";
import { getResultQuestionPresentation } from "@/lib/quiz/result-presentation";
import type { AdminHistoryDetail } from "@/lib/services/admin-service";

function directionLabel(ratio: number) {
  if (ratio === 100) return adminHistoryText.list.direction.englishToMeaning;
  if (ratio === 0) return adminHistoryText.list.direction.meaningToEnglish;
  return adminHistoryText.list.direction.mixed;
}

function questionStatus(
  initialIsCorrect: boolean | null,
  retryIsCorrect: boolean | null,
  reviewPending: boolean,
) {
  const copy = adminHistoryText.resultDetail.status;
  if (initialIsCorrect === true) {
    return { label: copy.initialCorrect, tone: "success" as const };
  }
  if (retryIsCorrect === true) {
    return { label: copy.resolvedAfterRetry, tone: "warning" as const };
  }
  if (retryIsCorrect === false) {
    return { label: copy.unresolved, tone: "danger" as const };
  }
  if (reviewPending) {
    return { label: copy.retryPending, tone: "danger" as const };
  }
  return { label: copy.incomplete, tone: "danger" as const };
}

export function AdminHistoryDetailHeading({
  detail,
  titleId,
}: {
  detail: AdminHistoryDetail;
  titleId: string;
}) {
  const { attempt, summary } = detail;
  const displayTitle = assignmentDisplayTitle(summary);

  return (
    <div className="history-detail-heading-copy">
      <h1 id={titleId}>{summary.studentName}</h1>
      {displayTitle ? <p>{displayTitle}</p> : null}
      <div className="history-detail-heading-tags">
        <AssignmentMetaTags {...summary} compact />
        <MetaTagList>
          {attempt ? (
            <MetaTag>
              {formatContentText(adminHistoryText.resultDetail.attemptNumber, {
                count: attempt.attemptNumber,
              })}
            </MetaTag>
          ) : null}
          {attempt?.startedAt ? (
            <MetaTag>{formatKoreanDateTime(attempt.startedAt)}</MetaTag>
          ) : null}
        </MetaTagList>
      </div>
    </div>
  );
}

export function AdminHistoryDetailContent({
  actions,
  detail,
}: {
  actions?: ReactNode;
  detail: AdminHistoryDetail;
}) {
  const { attempt, summary } = detail;
  const reviewPending =
    attempt?.status === "in_progress" && attempt.phase === "review";
  const wrongQuestions =
    attempt?.questions.filter((question) => question.initialIsCorrect !== true) ?? [];

  return (
    <div className="history-detail-content">
      <section className="history-detail-overview" aria-label={adminHistoryText.resultDetail.summaryAria}>
        <div className="history-detail-score-card">
          <AttemptScoreSummary
            finalScore={summary.finalScore}
            initialScore={summary.initialScore}
            passingScore={summary.passingScore}
            phase={summary.phase}
            retryStartedAt={summary.retryStartedAt}
            status={summary.status}
          />
          <ActivityStatusTimeline item={summary} />
        </div>

        <dl className="history-dialog-details history-detail-metadata">
          <div>
            <dt>{adminHistoryText.detailModal.dataset}</dt>
            <dd>{summary.datasetTitle}</dd>
          </div>
          <div>
            <dt>{adminHistoryText.detailModal.range}</dt>
            <dd>{assignmentScopeLabel(summary)}</dd>
          </div>
          <div>
            <dt>{adminHistoryText.detailModal.conditions}</dt>
            <dd>
              {formatContentText(adminHistoryText.list.conditions, {
                questions: summary.questionCount,
                minutes: Math.ceil(summary.timeLimitSeconds / 60),
                score: summary.passingScore,
              })}
            </dd>
          </div>
          <div>
            <dt>{adminHistoryText.detailModal.directionAndOrder}</dt>
            <dd>
              {directionLabel(summary.englishToKoreanRatio)} · {assignmentOrderLabel(summary.assignmentPurpose, summary.questionOrderMode)}
            </dd>
          </div>
          <div>
            <dt>{adminHistoryText.detailModal.assignedAt}</dt>
            <dd>{formatKoreanDateTime(summary.assignedAt)}</dd>
          </div>
          {summary.cancellationReason ? (
            <div>
              <dt>{adminHistoryText.detailModal.cancellationReason}</dt>
              <dd>{summary.cancellationReason}</dd>
            </div>
          ) : null}
        </dl>

        {attempt ? (
          <dl className="attempt-summary-grid">
            <div>
              <dt>{adminHistoryText.resultDetail.unresolvedCount}</dt>
              <dd>
                {formatContentText(adminHistoryText.resultDetail.count, {
                  count: attempt.unresolvedWrongCount ?? "-",
                })}
              </dd>
            </div>
            <div>
              <dt>{adminHistoryText.resultDetail.elapsed}</dt>
              <dd>{formatElapsed(attempt.elapsedSeconds)}</dd>
            </div>
          </dl>
        ) : (
          <p className="empty-state history-detail-no-attempt">
            {adminHistoryText.resultDetail.noAttempt}
          </p>
        )}
      </section>

      {attempt ? (
        <section aria-labelledby="answer-flow-heading" className="attempt-flow-section">
          <div className="section-heading">
            <h2 id="answer-flow-heading">{adminHistoryText.resultDetail.flowTitle}</h2>
            <CountBadge>
              {formatContentText(adminHistoryText.resultDetail.questionCount, {
                count: wrongQuestions.length,
              })}
            </CountBadge>
          </div>

          {wrongQuestions.length === 0 ? (
            <div className="empty-state">{adminHistoryText.resultDetail.allCorrect}</div>
          ) : (
            <div className="attempt-flow-list">
              {wrongQuestions.map((question) => {
                const resolved = question.retryIsCorrect === true;
                const presentation = getResultQuestionPresentation(question);
                const status = questionStatus(
                  question.initialIsCorrect,
                  question.retryIsCorrect,
                  reviewPending,
                );

                return (
                  <article className="card attempt-flow-card" key={question.id}>
                    <div className="title-with-status">
                      <div>
                        <p className="eyebrow">
                          {formatContentText(adminHistoryText.resultDetail.questionNumber, {
                            number: question.orderIndex,
                          })}
                        </p>
                        <h3>{presentation.prompt}</h3>
                      </div>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>

                    <div className={`answer-flow${resolved ? " answer-flow-resolved" : ""}`}>
                      <div className="flow-step flow-step-wrong">
                        <span>{adminHistoryText.resultDetail.initialChoice}</span>
                        <strong>{question.initialChoice ?? adminHistoryText.resultDetail.noChoice}</strong>
                      </div>
                      <span className="flow-arrow" aria-hidden="true">→</span>
                      <div className={`flow-step ${resolved ? "flow-step-correct" : "flow-step-wrong"}`}>
                        <span>{adminHistoryText.resultDetail.retry}</span>
                        <strong>
                          {question.retryChoice ??
                            (reviewPending
                              ? adminHistoryText.resultDetail.retryPending
                              : adminHistoryText.resultDetail.noChoice)}
                        </strong>
                        {resolved ? (
                          <span className="sr-only">
                            {adminHistoryText.resultDetail.retryCorrectSr}
                          </span>
                        ) : null}
                      </div>
                      {!resolved ? (
                        <>
                          <span className="flow-arrow" aria-hidden="true">→</span>
                          <div className="flow-step flow-step-answer">
                            <span>{adminHistoryText.resultDetail.answer}</span>
                            <strong>{presentation.correctAnswer}</strong>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {actions}
    </div>
  );
}
