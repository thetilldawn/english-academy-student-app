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
      <section aria-labelledby="student-wrong-words-title" className={styles.historySection}>
        <h3 id="student-wrong-words-title">오답 단어</h3>
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
          key={student.id}
          onDataUpdated={controller.actions.refreshData}
          onLoaded={controller.actions.cacheWrongWordHistory}
          studentId={student.id}
        />
      </section>
      <StudentAssignmentQueueHistory headingLevel={3} studentId={student.id} />
      <section aria-labelledby="student-learning-history-title" className={styles.historySection}>
        <h3 id="student-learning-history-title">시험 내역</h3>
        <StudentLearningActivityList
          filtersEnabled
          initialLimit={5}
          items={history}
        />
      </section>
    </section>
  );
}
