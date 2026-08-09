import type { Metadata } from "next";

import { ActivityStatusTimeline } from "@/components/activity-status-timeline";
import { DeadlineCountdown } from "@/components/deadline-countdown";
import { StartAttemptButton } from "@/components/start-attempt-button";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { CountBadge } from "@/components/count-badge";
import { ButtonLink } from "@/components/ui-button";
import { studentAppText } from "@/content/ko/student-app";
import { formatContentText } from "@/content/format";
import { requireStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  secondsUntil,
} from "@/lib/deadline";
import {
  assignmentOrderLabel,
  assignmentTypeLabel,
} from "@/lib/admin/history";
import { listStudentAssignments } from "@/lib/services/quiz-service";
import { buildAttemptStatusPresentation } from "@/lib/ui/attempt-score-presentation";
import type { ActivityTimelineInput } from "@/lib/ui/learning-activity-presentation";

export const metadata: Metadata = {
  title: studentAppText.dashboard.metadataTitle,
};

type StudentAssignment = Awaited<
  ReturnType<typeof listStudentAssignments>
>[number];

function assignmentTimeline(
  assignment: StudentAssignment,
): ActivityTimelineInput {
  const status = assignment.missed
    ? "missed"
    : (assignment.lastStatus ?? "not_started");
  return {
    status,
    phase: assignment.lastPhase,
    initialScore: assignment.lastInitialScore,
    finalScore: assignment.lastFinalScore,
    passingScore: assignment.passingScore,
    retryStartedAt: assignment.lastRetryStartedAt,
    assignedAt: assignment.assignedAt,
    availableUntil: assignment.availableUntil,
    cancelledAt: null,
    missedAt: assignment.missedAt,
    startedAt: assignment.lastStartedAt,
    initialCompletedAt: assignment.lastInitialCompletedAt,
    deadlineAt: assignment.lastDeadlineAt,
    completedAt: assignment.lastCompletedAt,
    activityAt:
      assignment.lastCompletedAt ??
      assignment.lastInitialCompletedAt ??
      assignment.lastStartedAt ??
      assignment.missedAt ??
      assignment.assignedAt,
  };
}

function AssignmentCard({
  assignment,
  featured = false,
}: {
  assignment: StudentAssignment;
  featured?: boolean;
}) {
  const initialDeadlineRemaining = secondsUntil(
    assignment.availableUntil,
    currentTimeMilliseconds(),
  );
  const timeline = assignmentTimeline(assignment);
  const outcome = buildAttemptStatusPresentation(timeline).outcome;

  return (
    <article
      className={[
        "card",
        "assignment-card",
        featured ? "assignment-card-featured" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-exam-outcome={outcome}
    >
      <div className="title-with-status">
        <div>
          <p className="eyebrow">{assignment.datasetTitle}</p>
          {assignment.displayTitle ? <h3>{assignment.displayTitle}</h3> : null}
        </div>
        <ActivityStatusTimeline
          className="student-assignment-timeline"
          item={timeline}
          showDeadline={
            !(assignment.availableUntil && assignment.lastStatus === null)
          }
        />
      </div>

      <MetaTagList className="assignment-details">
        <MetaTag>
          {assignmentTypeLabel(assignment.assignmentPurpose)}
        </MetaTag>
        <MetaTag>
          {assignment.scopeLabel}
        </MetaTag>
        {assignment.assignmentPurpose !== "review" && (
          <MetaTag>
            {formatContentText(studentAppText.dashboard.meta.questionCount, {
              count: assignment.questionCount,
            })}
          </MetaTag>
        )}
        <MetaTag>
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
        <MetaTag>
          {formatContentText(studentAppText.dashboard.meta.passingScore, {
            score: assignment.passingScore,
          })}
        </MetaTag>
        <MetaTag>
          {assignmentOrderLabel(
            assignment.assignmentPurpose,
            assignment.questionOrderMode,
          )}
        </MetaTag>
      </MetaTagList>

      {(assignment.lastInitialScore !== null || assignment.missed) && (
        <AttemptScoreSummary
          className="last-score"
          compact
          finalScore={assignment.lastFinalScore}
          initialScore={assignment.lastInitialScore}
          passingScore={assignment.passingScore}
          phase={assignment.lastPhase}
          retryStartedAt={assignment.lastRetryStartedAt}
          status={assignment.missed ? "missed" : assignment.lastStatus}
        />
      )}

      {assignment.availableUntil &&
        assignment.lastStatus === null &&
        initialDeadlineRemaining !== null && (
          <div className="assignment-deadline">
            <DeadlineCountdown
              deadlineAt={assignment.availableUntil}
              initialRemainingSeconds={initialDeadlineRemaining}
              refreshOnExpire={!assignment.missed}
            />
          </div>
        )}

      <div className="inline-actions assignment-actions">
        {assignment.lastStatus === "in_progress" &&
          assignment.lastPhase === "review" &&
          assignment.lastAttemptId && (
            <ButtonLink
              href={`/student/result/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.resultAndRetry}
            </ButtonLink>
          )}
        {assignment.lastStatus === "in_progress" &&
          assignment.lastPhase !== "review" &&
          assignment.lastAttemptId && (
            <ButtonLink
              href={`/student/attempt/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.resume}
            </ButtonLink>
          )}
        {assignment.lastStatus === "completed" &&
          assignment.lastAttemptId && (
            <ButtonLink
              variant="secondary"
              href={`/student/result/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.result}
            </ButtonLink>
          )}
        {assignment.lastStatus === "expired" &&
          assignment.lastAttemptId && (
            <ButtonLink
              variant="quiet"
              href={`/student/result/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.expiredResult}
            </ButtonLink>
          )}
        {assignment.canStart &&
          assignment.lastStatus !== "in_progress" && (
            <StartAttemptButton assignmentId={assignment.id} />
          )}
      </div>
    </article>
  );
}

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();
  const assignments = await listStudentAssignments(session.studentId);
  const sections = [
    {
      id: "open",
      title: studentAppText.dashboard.sections.open,
      assignments: assignments.filter(
        (assignment) => assignment.activitySection === "open",
      ),
    },
    {
      id: "needs-attention",
      title: studentAppText.dashboard.sections.needsAttention,
      assignments: assignments.filter(
        (assignment) =>
          !assignment.missed &&
          assignment.activitySection === "needs_attention",
      ),
    },
    {
      id: "completed",
      title: studentAppText.dashboard.sections.completed,
      assignments: assignments.filter(
        (assignment) => assignment.activitySection === "completed",
      ),
    },
    {
      id: "deadline-closed",
      title: studentAppText.dashboard.expired,
      assignments: assignments.filter((assignment) => assignment.missed),
    },
  ].filter((section) => section.assignments.length > 0);

  return (
    <main className="content student-content" id="main-content">
      <div className="page-heading student-page-heading">
        <div>
          <p className="eyebrow">{studentAppText.dashboard.eyebrow}</p>
          <h1>
            {session.displayName}{studentAppText.dashboard.titleSuffix}
          </h1>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="empty-state">
          {studentAppText.dashboard.emptyTitle}
          <br />
          {studentAppText.dashboard.emptyHelp}
        </div>
      ) : (
        <div className="student-assignment-sections">
          {sections.map((section, sectionIndex) => (
            <section
              aria-labelledby={`student-assignment-${section.id}`}
              className={sectionIndex === 0 ? undefined : "section"}
              key={section.id}
            >
              <div className="section-heading">
                <h2 id={`student-assignment-${section.id}`}>
                  {section.title}
                </h2>
                <CountBadge>
                  {formatContentText(studentAppText.dashboard.meta.sectionCount, {
                    count: section.assignments.length,
                  })}
                </CountBadge>
              </div>
              <div className="student-assignment-grid">
                {section.assignments.map((assignment, assignmentIndex) => (
                  <AssignmentCard
                    assignment={assignment}
                    featured={sectionIndex === 0 && assignmentIndex === 0}
                    key={assignment.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
