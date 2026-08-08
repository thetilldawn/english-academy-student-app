import type { Metadata } from "next";
import Link from "next/link";

import { DeadlineCountdown } from "@/components/deadline-countdown";
import { StartAttemptButton } from "@/components/start-attempt-button";
import { AttemptScoreSummary } from "@/components/attempt-score-summary";
import { studentAppText } from "@/content/ko/student-app";
import { requireStudentSession } from "@/lib/auth/student-session";
import {
  currentTimeMilliseconds,
  secondsUntil,
} from "@/lib/deadline";
import { assignmentOrderLabel } from "@/lib/admin/history";
import { formatKoreanDateTime } from "@/lib/format";
import { listStudentAssignments } from "@/lib/services/quiz-service";
import { buildAttemptStatusPresentation } from "@/lib/ui/attempt-score-presentation";

export const metadata: Metadata = {
  title: studentAppText.dashboard.metadataTitle,
};

type StudentAssignment = Awaited<
  ReturnType<typeof listStudentAssignments>
>[number];

function statusPresentation(assignment: StudentAssignment) {
  return buildAttemptStatusPresentation({
    status: assignment.missed ? "missed" : assignment.lastStatus,
    phase: assignment.lastPhase,
    initialScore: assignment.lastInitialScore,
    finalScore: assignment.lastFinalScore,
    passingScore: assignment.passingScore,
    retryStartedAt: assignment.lastRetryStartedAt,
  });
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

  return (
    <article
      className={[
        "card",
        "assignment-card",
        featured ? "assignment-card-featured" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="title-with-status">
        <div>
          <p className="eyebrow">{assignment.datasetTitle}</p>
          <h3>{assignment.title}</h3>
        </div>
        <span
          className={`status-pill ${statusPresentation(assignment).className}`}
        >
          {statusPresentation(assignment).label}
        </span>
      </div>

      <div className="assignment-details">
        <span className="detail-chip">
          {assignment.scopeLabel}
        </span>
        {assignment.assignmentPurpose !== "review" && (
          <span className="detail-chip">
            <strong>{assignment.questionCount}</strong>문항
          </span>
        )}
        <span className="detail-chip">
          {assignment.timingMode === "per_question"
            ? <>
                문제당 <strong>{assignment.questionTimeLimitSeconds}</strong>초
              </>
            : <>
                전체 <strong>{Math.ceil(assignment.timeLimitSeconds / 60)}</strong>분
              </>}
        </span>
        <span className="detail-chip">
          <strong>{assignment.passingScore}</strong>점 통과
        </span>
        <span className="detail-chip">
          {assignmentOrderLabel(
            assignment.assignmentPurpose,
            assignment.questionOrderMode,
          )}
        </span>
      </div>

      {(assignment.lastInitialScore !== null || assignment.missed) && (
        <AttemptScoreSummary
          className="last-score"
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
            <span>
              {studentAppText.dashboard.deadline}{" "}
              <strong>
                {formatKoreanDateTime(assignment.availableUntil)}
              </strong>
            </span>
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
            <Link
              className="button button-primary"
              href={`/student/result/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.resultAndRetry}
            </Link>
          )}
        {assignment.lastStatus === "in_progress" &&
          assignment.lastPhase !== "review" &&
          assignment.lastAttemptId && (
            <Link
              className="button button-primary"
              href={`/student/attempt/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.resume}
            </Link>
          )}
        {assignment.lastStatus === "completed" &&
          assignment.lastAttemptId && (
            <Link
              className="button button-secondary"
              href={`/student/result/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.result}
            </Link>
          )}
        {assignment.lastStatus === "expired" &&
          assignment.lastAttemptId && (
            <Link
              className="button button-quiet"
              href={`/student/result/${assignment.lastAttemptId}`}
            >
              {studentAppText.dashboard.expiredResult}
            </Link>
          )}
        {assignment.canStart &&
          assignment.lastStatus !== "in_progress" && (
            <StartAttemptButton assignmentId={assignment.id} />
          )}
      </div>
    </article>
  );
}

function selectPrimaryAssignment(assignments: StudentAssignment[]) {
  return (
    assignments.find(
      (assignment) => assignment.lastStatus === "in_progress",
    ) ??
    assignments.find(
      (assignment) =>
        assignment.canStart && assignment.lastStatus !== "completed",
    ) ??
    assignments.find((assignment) => assignment.canStart) ??
    assignments[0]
  );
}

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();
  const assignments = await listStudentAssignments(session.studentId);
  const primaryAssignment = selectPrimaryAssignment(assignments);
  const otherAssignments = primaryAssignment
    ? assignments.filter(
        (assignment) => assignment.id !== primaryAssignment.id,
      )
    : [];
  const primaryHeading =
    primaryAssignment?.lastPhase === "review"
      ? studentAppText.dashboard.firstResult
      : primaryAssignment?.missed
        ? studentAppText.dashboard.expired
      : primaryAssignment?.lastStatus === "in_progress" ||
    primaryAssignment?.canStart
      ? studentAppText.dashboard.current
      : studentAppText.dashboard.recent;

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

      {!primaryAssignment ? (
        <div className="empty-state">
          {studentAppText.dashboard.emptyTitle}
          <br />
          {studentAppText.dashboard.emptyHelp}
        </div>
      ) : (
        <>
          <section aria-labelledby="primary-assignment-heading">
            <div className="section-heading">
              <h2 id="primary-assignment-heading">{primaryHeading}</h2>
            </div>
            <AssignmentCard assignment={primaryAssignment} featured />
          </section>

          {otherAssignments.length > 0 && (
            <section
              aria-labelledby="other-assignments-heading"
              className="section"
            >
              <div className="section-heading">
                <h2 id="other-assignments-heading">
                  {studentAppText.dashboard.others}
                </h2>
                <span className="detail-chip">
                  <strong>{otherAssignments.length}</strong>건
                </span>
              </div>
              <div className="student-assignment-grid">
                {otherAssignments.map((assignment) => (
                  <AssignmentCard
                    assignment={assignment}
                    key={assignment.id}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
