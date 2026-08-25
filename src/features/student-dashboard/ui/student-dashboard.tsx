import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import { CurrentPointSummary } from "@/features/learning-points/ui/point-summary";
import { currentTimeMilliseconds } from "@/lib/deadline";

import {
  selectStudentAssignmentSections,
  type StudentAssignmentSectionId,
} from "../domain/student-assignment-sections";
import type { StudentAssignmentSummary } from "../model";
import { StudentAssignmentCard } from "./student-assignment-card";
import styles from "./student-dashboard.module.css";

const sectionTitles: Record<StudentAssignmentSectionId, string> = {
  open: studentAppText.dashboard.sections.open,
  scheduled: studentAppText.dashboard.sections.scheduled,
  "needs-attention": studentAppText.dashboard.sections.needsAttention,
  completed: studentAppText.dashboard.sections.completed,
  "deadline-closed": studentAppText.dashboard.sections.closed,
};

export function StudentDashboard({
  assignments,
  currentPoints,
}: {
  assignments: readonly StudentAssignmentSummary[];
  currentPoints: number;
  displayName: string;
}) {
  const nowMilliseconds = currentTimeMilliseconds();
  const sections = selectStudentAssignmentSections(assignments, nowMilliseconds);
  const visibleSections = sections.filter(
    (section) => section.assignments.length > 0,
  );

  return (
    <main className={styles.page} id="main-content">
      <div className={styles.pointSummary}>
        <CurrentPointSummary currentPoints={currentPoints} />
      </div>
      {visibleSections.length === 0 ? (
        <div className={styles.empty} role="status">
          {studentAppText.dashboard.emptyTitle}
          <br />
          {studentAppText.dashboard.emptyHelp}
        </div>
      ) : (
        <div className={styles.sectionList}>
          {visibleSections.map((section) => (
            <div
              className={styles.section}
              data-assignment-section={section.id}
              key={section.id}
            >
              <CollapsibleStatusSection
                countLabel={formatContentText(
                  studentAppText.dashboard.meta.sectionCount,
                  { count: section.assignments.length },
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
          ))}
        </div>
      )}
    </main>
  );
}
