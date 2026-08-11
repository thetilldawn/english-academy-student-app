import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { Button } from "@/design-system/primitives/button/button";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import { AssignmentStudentRow } from "./assignment-student-row";
import { AssignmentWorkspaceFilters } from "./assignment-workspace-filters";
import styles from "./assignment-workspace.module.css";

export function AssignmentStudentBrowser({
  controller,
}: {
  controller: AssignmentWorkspaceController;
}) {
  return (
    <section
      aria-labelledby="vocabulary-learning-tab"
      className={styles.browser}
      id="vocabulary-learning-panel"
      role="tabpanel"
    >
      <AssignmentWorkspaceFilters controller={controller} />

      <div className={styles.bulkBar}>
        <div className={styles.bulkSummary}>
          <strong>
            {formatContentText(adminLearningText.page.bulk.selectedCount, {
              count: controller.selectedBulkStudentIds.length,
            })}
          </strong>
          <small>{adminLearningText.page.bulk.maximum}</small>
          <Button
            onClick={controller.actions.toggleFilteredStudents}
            size="small"
            variant="quiet"
          >
            {controller.allFilteredStudentsSelected
              ? adminLearningText.page.bulk.clearVisible
              : formatContentText(adminLearningText.page.bulk.selectVisible, {
                  count: controller.filteredStudents.length,
                })}
          </Button>
          {controller.selectedBulkStudentIds.length > 0 ? (
            <Button
              onClick={controller.actions.clearBulkStudents}
              size="small"
              variant="quiet"
            >
              {adminLearningText.page.bulk.clearAll}
            </Button>
          ) : null}
        </div>
        <div className={styles.bulkActions}>
          <Button
            disabled={
              controller.selectedBulkStudentIds.length === 0 ||
              controller.readyDatasets.length === 0
            }
            onClick={() => controller.actions.setBulkMode("with_wrong")}
            size="small"
          >
            {adminLearningText.page.bulk.includeWrong}
          </Button>
          <Button
            disabled={
              controller.selectedBulkStudentIds.length === 0 ||
              controller.readyDatasets.length === 0
            }
            onClick={() => controller.actions.setBulkMode("next")}
            size="small"
            variant="primary"
          >
            {adminLearningText.page.bulk.assignNext}
          </Button>
        </div>
      </div>

      {controller.readyDatasets.length === 0 ? (
        <div className={styles.notice} role="status">
          {adminLearningText.page.bulk.noReadyDatasets}
        </div>
      ) : null}

      {controller.filteredStudents.length === 0 ? (
        <div className={styles.empty} role="status">
          {adminLearningText.page.noStudents}
        </div>
      ) : (
        <div className={styles.studentList}>
          {controller.filteredStudents.map((student) => (
            <AssignmentStudentRow
              controller={controller}
              key={student.id}
              student={student}
            />
          ))}
        </div>
      )}
    </section>
  );
}
