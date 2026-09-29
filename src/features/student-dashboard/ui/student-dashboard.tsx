import type { ReactNode } from "react";
import { studentAppText } from "@/content/ko/student-app";
import type { StudentDashboardInitialSnapshot } from "@/features/student-dashboard/contracts/student-dashboard-read-model";

import {
  selectStudentDashboardCurrentSections,
  type StudentAssignmentSectionId,
} from "../domain/student-assignment-sections";
import { StudentCurrentAssignments } from "./student-current-assignments";
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
  snapshot,
  schoolSchedule,
}: {
  snapshot: StudentDashboardInitialSnapshot;
  schoolSchedule?: ReactNode;
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
      {schoolSchedule}
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
            const readSection = section.id === "needs-attention" ? "needs_attention"
              : section.id === "deadline-closed" ? "deadline_closed" : section.id;
            return (
              <StudentCurrentAssignments
                initialPage={{ items: section.assignments, nextCursor: snapshot.currentCursors[readSection] }}
                key={`${snapshot.snapshotAt}:${section.id}`}
                sectionId={section.id}
                title={sectionTitles[section.id]}
                nowMilliseconds={nowMilliseconds}
                totalCount={sectionCount(section.id)}
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
