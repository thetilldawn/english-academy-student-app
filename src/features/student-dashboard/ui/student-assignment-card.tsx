import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import {
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import { ButtonLink } from "@/design-system/primitives/button/button";
import { AttemptScoreSummary } from "@/features/history/ui/attempt-score-summary";
import { ActivityStatusTimeline } from "@/features/history/ui/activity-status-timeline";
import {
  assignmentOrderLabel,
  assignmentTypeLabel,
} from "@/lib/admin/history";
import { assignmentTimingLabel } from "@/lib/admin/assignment-settings";
import { currentTimeMilliseconds } from "@/lib/deadline";
import { buildAttemptStatusPresentation } from "@/features/history/presentation/attempt-presentation";

import { studentAssignmentTimeline } from "../domain/student-assignment-sections";
import { deriveStudentAssignmentLifecycle } from "../domain/student-assignment-lifecycle";
import type { StudentAssignmentSummary } from "../model";
import { StartAttemptButton } from "./start-attempt-button";
import { StudentAssignmentAvailability } from "./student-assignment-availability";
import styles from "./student-assignment-card.module.css";

export function StudentAssignmentCard({
  assignment,
  nowMilliseconds = currentTimeMilliseconds(),
}: {
  assignment: StudentAssignmentSummary;
  nowMilliseconds?: number;
}) {
  const lifecycle = deriveStudentAssignmentLifecycle(
    assignment,
    nowMilliseconds,
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
        <div className={styles.statusColumn}>
          {lifecycle.progress === "not_started" ? (
            <StatusBadge
              tone={
                lifecycle.window.kind === "open"
                  ? "success"
                  : lifecycle.window.kind === "scheduled"
                    ? "warning"
                    : "neutral"
              }
            >
              {lifecycle.window.kind === "open"
                ? studentAppText.dashboard.availability.open
                : lifecycle.window.kind === "scheduled"
                  ? studentAppText.dashboard.availability.scheduled
                  : studentAppText.dashboard.availability.closed}
            </StatusBadge>
          ) : (
            <ActivityStatusTimeline
              align="end"
              deadlineLabel={studentAppText.dashboard.attemptEndsAt}
              item={timeline}
              showDeadline={
                lifecycle.progress === "initial_in_progress" ||
                lifecycle.progress === "retry_in_progress"
              }
            />
          )}
        </div>
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
          {assignmentTimingLabel(assignment)}
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

      <StudentAssignmentAvailability
        assignment={assignment}
        lifecycle={lifecycle}
        nowMilliseconds={nowMilliseconds}
      />

      {assignment.lastInitialScore !== null || lifecycle.progress === "missed" ? (
        <AttemptScoreSummary
          compact
          finalScore={assignment.lastFinalScore}
          initialScore={assignment.lastInitialScore}
          passed={assignment.lastPassed}
          passingScore={assignment.passingScore}
          phase={assignment.lastPhase}
          retryStartedAt={assignment.lastRetryStartedAt}
          status={
            lifecycle.progress === "missed" ? "missed" : assignment.lastStatus
          }
        />
      ) : null}

      <div className={styles.actions}>
        {lifecycle.actions.canReviewAndRetry && assignment.lastAttemptId ? (
          <ButtonLink href={`/student/result/${assignment.lastAttemptId}`}>
            {studentAppText.dashboard.resultAndRetry}
          </ButtonLink>
        ) : null}
        {lifecycle.actions.canResume && assignment.lastAttemptId ? (
          <ButtonLink href={`/student/attempt/${assignment.lastAttemptId}`}>
            {studentAppText.dashboard.resume}
          </ButtonLink>
        ) : null}
        {lifecycle.actions.canViewResult &&
        assignment.lastStatus === "completed" &&
        assignment.lastAttemptId ? (
          <ButtonLink
            href={`/student/result/${assignment.lastAttemptId}`}
            variant="secondary"
          >
            {studentAppText.dashboard.result}
          </ButtonLink>
        ) : null}
        {lifecycle.actions.canViewResult &&
        assignment.lastStatus === "expired" &&
        assignment.lastAttemptId ? (
          <ButtonLink
            href={`/student/result/${assignment.lastAttemptId}`}
            variant="quiet"
          >
            {studentAppText.dashboard.expiredResult}
          </ButtonLink>
        ) : null}
        {lifecycle.actions.canStart ? (
          <StartAttemptButton assignmentId={assignment.id} />
        ) : null}
      </div>
    </article>
  );
}
