import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import {
  MetaTag,
  MetaTagList,
} from "@/design-system/primitives/badge/badge";
import { ButtonLink } from "@/design-system/primitives/button/button";
import { AttemptScoreSummary } from "@/features/history/ui/attempt-score-summary";
import { ActivityStatusTimeline } from "@/features/history/ui/activity-status-timeline";
import {
  assignmentOrderLabel,
  assignmentTypeLabel,
} from "@/lib/admin/history";
import {
  currentTimeMilliseconds,
  secondsUntil,
} from "@/lib/deadline";
import { buildAttemptStatusPresentation } from "@/features/history/presentation/attempt-presentation";

import { studentAssignmentTimeline } from "../domain/student-assignment-sections";
import type { StudentAssignmentSummary } from "../model";
import { DeadlineCountdown } from "./deadline-countdown";
import { StartAttemptButton } from "./start-attempt-button";
import styles from "./student-assignment-card.module.css";

export function StudentAssignmentCard({
  assignment,
}: {
  assignment: StudentAssignmentSummary;
}) {
  const initialDeadlineRemaining = secondsUntil(
    assignment.availableUntil,
    currentTimeMilliseconds(),
  );
  const timeline = studentAssignmentTimeline(assignment);
  const outcome = buildAttemptStatusPresentation(timeline).outcome;
  const heading = assignment.displayTitle || assignment.datasetTitle;
  const showDatasetSubtitle = assignment.displayTitle.length > 0;

  return (
    <article
      aria-labelledby={`student-assignment-${assignment.id}-title`}
      className={styles.card}
      data-assignment-id={assignment.id}
      data-exam-outcome={outcome}
    >
      <div className={styles.titleRow}>
        <div className={styles.titleCopy}>
          {showDatasetSubtitle ? (
            <p className={styles.dataset} title={assignment.datasetTitle}>
              {assignment.datasetTitle}
            </p>
          ) : null}
          <h3
            className={styles.title}
            id={`student-assignment-${assignment.id}-title`}
            title={heading}
          >
            {heading}
          </h3>
        </div>
        <ActivityStatusTimeline
          align="end"
          item={timeline}
          showDeadline={
            !(assignment.availableUntil && assignment.lastStatus === null)
          }
        />
      </div>

      <MetaTagList className={styles.details} fullWidth>
        <MetaTag size="large">
          {assignmentTypeLabel(assignment.assignmentPurpose)}
        </MetaTag>
        <MetaTag size="large">
          {assignment.scopeLabel}
        </MetaTag>
        {assignment.assignmentPurpose !== "review" ? (
          <MetaTag size="large">
            {formatContentText(studentAppText.dashboard.meta.questionCount, {
              count: assignment.questionCount,
            })}
          </MetaTag>
        ) : null}
        <MetaTag size="large">
          {assignment.timingMode === "per_question"
            ? formatContentText(
                studentAppText.dashboard.meta.perQuestion,
                { seconds: assignment.questionTimeLimitSeconds ?? 0 },
              )
            : formatContentText(
                studentAppText.dashboard.meta.totalMinutes,
                { minutes: Math.ceil(assignment.timeLimitSeconds / 60) },
              )}
        </MetaTag>
        <MetaTag size="large">
          {formatContentText(studentAppText.dashboard.meta.passingScore, {
            score: assignment.passingScore,
          })}
        </MetaTag>
        <MetaTag size="large">
          {assignmentOrderLabel(
            assignment.assignmentPurpose,
            assignment.questionOrderMode,
          )}
        </MetaTag>
      </MetaTagList>

      {assignment.lastInitialScore !== null || assignment.missed ? (
        <AttemptScoreSummary
          compact
          finalScore={assignment.lastFinalScore}
          initialScore={assignment.lastInitialScore}
          passed={assignment.lastPassed}
          passingScore={assignment.passingScore}
          phase={assignment.lastPhase}
          retryStartedAt={assignment.lastRetryStartedAt}
          status={assignment.missed ? "missed" : assignment.lastStatus}
        />
      ) : null}

      {!assignment.missed &&
      assignment.availableUntil &&
      assignment.lastStatus === null &&
      initialDeadlineRemaining !== null ? (
        <div className={styles.deadline}>
          <span>{studentAppText.dashboard.deadline}</span>
          <DeadlineCountdown
            deadlineAt={assignment.availableUntil}
            initialRemainingSeconds={initialDeadlineRemaining}
            refreshOnExpire
          />
        </div>
      ) : null}

      <div className={styles.actions}>
        {assignment.lastStatus === "in_progress" &&
        assignment.lastPhase === "review" &&
        assignment.lastAttemptId ? (
          <ButtonLink href={`/student/result/${assignment.lastAttemptId}`}>
            {studentAppText.dashboard.resultAndRetry}
          </ButtonLink>
        ) : null}
        {assignment.lastStatus === "in_progress" &&
        assignment.lastPhase !== "review" &&
        assignment.lastAttemptId ? (
          <ButtonLink href={`/student/attempt/${assignment.lastAttemptId}`}>
            {studentAppText.dashboard.resume}
          </ButtonLink>
        ) : null}
        {assignment.lastStatus === "completed" &&
        assignment.lastAttemptId ? (
          <ButtonLink
            href={`/student/result/${assignment.lastAttemptId}`}
            variant="secondary"
          >
            {studentAppText.dashboard.result}
          </ButtonLink>
        ) : null}
        {assignment.lastStatus === "expired" &&
        assignment.lastAttemptId ? (
          <ButtonLink
            href={`/student/result/${assignment.lastAttemptId}`}
            variant="quiet"
          >
            {studentAppText.dashboard.expiredResult}
          </ButtonLink>
        ) : null}
        {assignment.canStart && assignment.lastStatus !== "in_progress" ? (
          <StartAttemptButton assignmentId={assignment.id} />
        ) : null}
      </div>
    </article>
  );
}
