import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import { CurrentPointSummary } from "@/features/learning-points/public-ui";
import type { StudentDashboardInitialSnapshot } from "@/features/student-dashboard/contracts/student-dashboard-read-model";

import {
  selectStudentDashboardCurrentSections,
  type StudentAssignmentSectionId,
} from "../domain/student-assignment-sections";
import { StudentAssignmentCard } from "./student-assignment-card";
import { StudentCompletedAssignments } from "./student-completed-assignments";
import styles from "./student-dashboard.module.css";

const sectionTitles: Record<StudentAssignmentSectionId, string> = {
  open: studentAppText.dashboard.sections.open,
  scheduled: studentAppText.dashboard.sections.scheduled,
  "needs-attention": studentAppText.dashboard.sections.needsAttention,
  completed: studentAppText.dashboard.sections.completed,
  "deadline-closed": studentAppText.dashboard.sections.closed,
};

export function StudentDashboard({
  currentPoints,
  snapshot,
}: {
  currentPoints: number;
  snapshot: StudentDashboardInitialSnapshot;
}) {
  const nowMilliseconds = Date.parse(snapshot.snapshotAt);
  const sections = selectStudentDashboardCurrentSections(
    snapshot.currentAssignments,
  );
  const totalCount = Object.values(snapshot.sectionCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const sectionCount = (sectionId: StudentAssignmentSectionId) => {
    if (sectionId === "needs-attention") {
      return snapshot.sectionCounts.needs_attention;
    }
    if (sectionId === "deadline-closed") {
      return snapshot.sectionCounts.deadline_closed;
    }
    return snapshot.sectionCounts[sectionId];
  };

  return (
    <main className={styles.page} id="main-content">
      <div className={styles.pointSummary}>
        <CurrentPointSummary currentPoints={currentPoints} />
      </div>
      {totalCount === 0 ? (
        <div className={styles.empty} role="status">
          {studentAppText.dashboard.emptyTitle}
          <br />
          {studentAppText.dashboard.emptyHelp}
        </div>
      ) : (
        <div className={styles.sectionList}>
          {sections.map((section) => {
            if (section.id === "completed") {
              return snapshot.sectionCounts.completed > 0 ? (
                <StudentCompletedAssignments
                  initialPage={snapshot.completedPage}
                  key={snapshot.snapshotAt}
                  nowMilliseconds={nowMilliseconds}
                  totalCount={snapshot.sectionCounts.completed}
                />
              ) : null;
            }
            if (section.assignments.length === 0) return null;
            return (
              <div
                className={styles.section}
                data-assignment-section={section.id}
                key={section.id}
              >
                <CollapsibleStatusSection
                  countLabel={formatContentText(
                    studentAppText.dashboard.meta.sectionCount,
                    { count: sectionCount(section.id) },
                  )}
                  defaultOpen={section.id === "open"}
                  id={`student-assignment-${section.id}`}
                  title={sectionTitles[section.id]}
                >
                  <div className={styles.grid}>
                    {section.assignments.map((assignment) => (
                      <StudentAssignmentCard
                        assignment={assignment}
                        key={assignment.id}
                        nowMilliseconds={nowMilliseconds}
                      />
                    ))}
                  </div>
                </CollapsibleStatusSection>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
