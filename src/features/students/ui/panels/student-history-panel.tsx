import { StudentLearningActivityList } from "@/features/history/ui/student-learning-activity-list";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import type { StudentManagementData } from "../../model";
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
      <StudentLearningActivityList
        filtersEnabled
        initialLimit={5}
        items={history}
      />
    </section>
  );
}
