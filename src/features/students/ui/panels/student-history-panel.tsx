import { StudentLearningActivityList } from "@/features/history/ui/student-learning-activity-list";
import { StudentAssignmentQueueHistory } from "@/features/assignment-queue/ui/student-assignment-queue-history";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import type { StudentManagementData } from "../../model";
import { StudentWrongWordPanel } from "./student-wrong-word-panel";
import styles from "../student-detail.module.css";

export function StudentHistoryPanel({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const student = controller.selectedStudent;
  if (!student) return null;
  const history = data.history.filter((item) => item.studentId === student.id);
  return (
    <section
      aria-labelledby="student-history-tab"
      className={styles.panel}
      id="student-history-panel"
      role="tabpanel"
    >
      <StudentWrongWordPanel
        active
        cachedAt={
          controller.wrongHistoryByStudent[student.id]?.loadedAt ?? null
        }
        cachedHistory={
          controller.wrongHistoryByStudent[student.id]?.history ?? null
        }
        initialCurriculumStage={student.readingCurriculumStage}
        initialDatasetId={student.currentVocabDatasetId ?? ""}
        initialReadingContextSyncStatus={student.readingContextSyncStatus}
        onDataUpdated={controller.actions.refreshData}
        onLoaded={controller.actions.cacheWrongWordHistory}
        studentId={student.id}
      />
      <StudentAssignmentQueueHistory studentId={student.id} />
      <StudentLearningActivityList
        filtersEnabled
        initialLimit={5}
        items={history}
      />
    </section>
  );
}
