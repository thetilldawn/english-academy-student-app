import type { ReactNode } from "react";

import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";
import {
  CountBadge,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import { AttemptQuestionCard } from "@/features/results/ui/attempt-question-card";
import { AdminAttemptPointSummaryView } from "@/features/learning-points/ui/point-summary";
import {
  assignmentOrderLabel,
  assignmentScopeLabel,
} from "@/lib/admin/history";
import { assignmentTimingLabel } from "@/lib/admin/assignment-settings";
import { formatElapsed, formatKoreanDateTime } from "@/lib/format";
import { getResultQuestionPresentation } from "@/lib/quiz/result-presentation";
import type { AdminHistoryDetail } from "../model";

import { ActivityStatusTimeline } from "./activity-status-timeline";
import { AttemptScoreSummary } from "./attempt-score-summary";
import styles from "./admin-history-detail.module.css";

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
    attempt?.questions.filter(
      (question) => question.initialIsCorrect !== true,
    ) ?? [];

  return (
    <div className={styles.content}>
      <section
        aria-label={adminHistoryText.resultDetail.summaryAria}
        className={styles.overview}
      >
        <div className={styles.scoreCard}>
          <AttemptScoreSummary
            finalScore={summary.finalScore}
            initialScore={summary.initialScore}
            passed={summary.passed}
            passingScore={summary.passingScore}
            phase={summary.phase}
            retryStartedAt={summary.retryStartedAt}
            status={summary.status}
          />
          <ActivityStatusTimeline item={summary} />
        </div>

        {detail.pointSummary ? (
          <AdminAttemptPointSummaryView summary={detail.pointSummary} />
        ) : null}

        <dl className={styles.metadata}>
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
                timing: assignmentTimingLabel(summary),
                score: summary.passingScore,
              })}
            </dd>
          </div>
          <div>
            <dt>{adminHistoryText.detailModal.directionAndOrder}</dt>
            <dd>
              {directionLabel(summary.englishToKoreanRatio)} ·{" "}
              {assignmentOrderLabel(
                summary.assignmentPurpose,
                summary.questionOrderMode,
              )}
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
          <dl className={styles.summaryGrid}>
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
          <p className={styles.empty}>
            {adminHistoryText.resultDetail.noAttempt}
          </p>
        )}
      </section>

      {attempt ? (
        <section
          aria-labelledby="answer-flow-heading"
          className={styles.flowSection}
        >
          <div className={styles.sectionHeading}>
            <h2 id="answer-flow-heading">
              {adminHistoryText.resultDetail.flowTitle}
            </h2>
            <CountBadge>
              {formatContentText(adminHistoryText.resultDetail.questionCount, {
                count: wrongQuestions.length,
              })}
            </CountBadge>
          </div>

          {wrongQuestions.length === 0 ? (
            <div className={styles.empty}>
              {adminHistoryText.resultDetail.allCorrect}
            </div>
          ) : (
            <div className={styles.flowList}>
              {wrongQuestions.map((question) => {
                const resolved = question.retryIsCorrect === true;
                const presentation = getResultQuestionPresentation(question);
                const status = questionStatus(
                  question.initialIsCorrect,
                  question.retryIsCorrect,
                  reviewPending,
                );

                return (
                  <AttemptQuestionCard
                    eyebrow={formatContentText(
                      adminHistoryText.resultDetail.questionNumber,
                      { number: question.orderIndex },
                    )}
                    key={question.id}
                    prompt={presentation.prompt}
                    status={
                      <StatusBadge tone={status.tone}>
                        {status.label}
                      </StatusBadge>
                    }
                    wrongLevel={question.wrongCount >= 2 ? 2 : 1}
                  >
                    <div
                      className={styles.answerFlow}
                      data-resolved={resolved || undefined}
                    >
                      <div className={styles.wrongStep}>
                        <span>
                          {adminHistoryText.resultDetail.initialChoice}
                        </span>
                        <strong>
                          {question.initialChoice ??
                            adminHistoryText.resultDetail.noChoice}
                        </strong>
                      </div>
                      <span aria-hidden="true" className={styles.arrow}>
                        →
                      </span>
                      <div
                        className={
                          resolved ? styles.correctStep : styles.wrongStep
                        }
                      >
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
                          <span aria-hidden="true" className={styles.arrow}>
                            →
                          </span>
                          <div className={styles.answerStep}>
                            <span>{adminHistoryText.resultDetail.answer}</span>
                            <strong>{presentation.correctAnswer}</strong>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </AttemptQuestionCard>
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
