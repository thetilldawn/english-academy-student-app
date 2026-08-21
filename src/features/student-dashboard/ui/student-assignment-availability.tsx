import { studentAppText } from "@/content/ko/student-app";
import {
  millisecondsUntil,
  secondsUntil,
} from "@/lib/deadline";
import { formatKoreanActivityDateTime } from "@/lib/format";

import type { StudentAssignmentLifecycle } from "../domain/student-assignment-lifecycle";
import type { StudentAssignmentSummary } from "../model";
import { AssignmentBoundaryRefresh } from "./assignment-boundary-refresh";
import { DeadlineCountdown } from "./deadline-countdown";
import styles from "./student-assignment-card.module.css";

export function StudentAssignmentAvailability({
  assignment,
  lifecycle,
  nowMilliseconds,
}: {
  assignment: Pick<
    StudentAssignmentSummary,
    "availableFrom" | "availableUntil"
  >;
  lifecycle: StudentAssignmentLifecycle;
  nowMilliseconds: number;
}) {
  const openingRemainingMilliseconds =
    lifecycle.window.kind === "scheduled"
      ? millisecondsUntil(lifecycle.window.opensAt, nowMilliseconds)
      : null;
  const closingRemainingMilliseconds =
    lifecycle.window.kind === "open" && lifecycle.actions.canStart
      ? millisecondsUntil(lifecycle.window.closesAt, nowMilliseconds)
      : null;
  const closingRemainingSeconds = secondsUntil(
    lifecycle.window.closesAt,
    nowMilliseconds,
  );

  return (
    <>
      <dl className={styles.schedule}>
        <div>
          <dt>{studentAppText.dashboard.availability.opensAt}</dt>
          <dd>
            {assignment.availableFrom ? (
              <time dateTime={assignment.availableFrom}>
                {formatKoreanActivityDateTime(assignment.availableFrom)}
              </time>
            ) : (
              studentAppText.dashboard.availability.availableNow
            )}
          </dd>
        </div>
        <div>
          <dt>{studentAppText.dashboard.availability.closesAt}</dt>
          <dd>
            {assignment.availableUntil ? (
              <time dateTime={assignment.availableUntil}>
                {formatKoreanActivityDateTime(assignment.availableUntil)}
              </time>
            ) : (
              studentAppText.dashboard.availability.noDeadline
            )}
          </dd>
        </div>
      </dl>

      {lifecycle.window.kind === "scheduled" &&
      openingRemainingMilliseconds !== null ? (
        <AssignmentBoundaryRefresh
          boundaryAt={lifecycle.window.opensAt}
          initialRemainingMilliseconds={openingRemainingMilliseconds}
        />
      ) : null}

      {lifecycle.window.kind === "open" &&
      lifecycle.actions.canStart &&
      lifecycle.window.closesAt &&
      closingRemainingMilliseconds !== null ? (
        <AssignmentBoundaryRefresh
          boundaryAt={lifecycle.window.closesAt}
          initialRemainingMilliseconds={closingRemainingMilliseconds}
        />
      ) : null}

      {lifecycle.window.kind === "open" &&
      lifecycle.progress === "not_started" &&
      lifecycle.window.closesAt &&
      closingRemainingSeconds !== null ? (
        <div className={styles.deadline}>
          <span>{studentAppText.dashboard.deadline}</span>
          <DeadlineCountdown
            deadlineAt={lifecycle.window.closesAt}
            initialRemainingSeconds={closingRemainingSeconds}
          />
        </div>
      ) : null}
    </>
  );
}
