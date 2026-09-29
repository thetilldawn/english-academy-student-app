"use client";

import { studentAppText } from "@/content/ko/student-app";
import { formatContentText } from "@/content/format";
import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import { Button } from "@/design-system/primitives/button/button";
import type { StudentDashboardCompletedPage } from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import { useStudentAssignmentPage } from "@/features/student-dashboard/controller/use-student-assignment-page";

import { StudentAssignmentCard } from "./student-assignment-card";
import styles from "./student-dashboard.module.css";

export function StudentCurrentAssignments({
  initialPage,
  sectionId,
  title,
  nowMilliseconds,
  totalCount,
}: {
  initialPage: StudentDashboardCompletedPage;
  sectionId: string;
  title: string;
  nowMilliseconds: number;
  totalCount: number;
}) {
  const { navigationRequired, error, items, loadMore, loading, nextCursor } =
    useStudentAssignmentPage(initialPage, "current");
  if (navigationRequired) return <p role="alert">{error}</p>;
  return (
    <div className={styles.section} data-assignment-section={sectionId}>
      <CollapsibleStatusSection
        countLabel={formatContentText(
          studentAppText.dashboard.meta.sectionCount,
          { count: totalCount },
        )}
        id={`student-assignment-${sectionId}`}
        defaultOpen={sectionId === "open"}
        title={title}
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
