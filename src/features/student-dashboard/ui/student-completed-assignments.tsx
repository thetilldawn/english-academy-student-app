"use client";

import { studentAppText } from "@/content/ko/student-app";
import { formatContentText } from "@/content/format";
import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import { Button } from "@/design-system/primitives/button/button";
import type { StudentDashboardCompletedPage } from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import { useStudentCompletedAssignments } from "@/features/student-dashboard/controller/use-student-completed-assignments";

import { StudentAssignmentCard } from "./student-assignment-card";
import styles from "./student-dashboard.module.css";

export function StudentCompletedAssignments({
  initialPage,
  nowMilliseconds,
  totalCount,
}: {
  initialPage: StudentDashboardCompletedPage;
  nowMilliseconds: number;
  totalCount: number;
}) {
  const { error, items, loadMore, loading, nextCursor } =
    useStudentCompletedAssignments(initialPage);
  return (
    <div className={styles.section} data-assignment-section="completed">
      <CollapsibleStatusSection
        countLabel={formatContentText(
          studentAppText.dashboard.meta.sectionCount,
          { count: totalCount },
        )}
        id="student-assignment-completed"
        title={studentAppText.dashboard.sections.completed}
      >
        <div className={styles.completedContent}>
          <div className={styles.grid}>
            {items.map((assignment) => (
              <StudentAssignmentCard
                assignment={assignment}
                key={assignment.id}
                nowMilliseconds={nowMilliseconds}
              />
            ))}
          </div>
          {error ? (
            <p className={styles.loadError} role="alert">{error}</p>
          ) : null}
          {nextCursor ? (
            <Button
              className={styles.loadMore}
              disabled={loading}
              onClick={() => void loadMore()}
              variant="secondary"
            >
              {loading
                ? studentAppText.dashboard.history.loading
                : studentAppText.dashboard.history.loadMore}
            </Button>
          ) : null}
        </div>
      </CollapsibleStatusSection>
    </div>
  );
}
