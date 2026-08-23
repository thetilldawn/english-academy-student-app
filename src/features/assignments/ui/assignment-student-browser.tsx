import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { Button } from "@/design-system/primitives/button/button";
import { Tabs } from "@/design-system/primitives/tabs/tabs";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import { AssignmentStudentRow } from "./assignment-student-row";
import { AssignmentWorkspaceFilters } from "./assignment-workspace-filters";
import { SelectedStudentBasket } from "./selected-student-basket";
import { VocabAssignmentEntrySelector } from "./vocab-assignment-entry-selector";
import styles from "./assignment-workspace.module.css";

export function AssignmentStudentBrowser({
  controller,
}: {
  controller: AssignmentWorkspaceController;
}) {
  return (
    <section aria-label="단어 시험 대상 선택" className={styles.browser}>
      <Tabs
        ariaLabel="단어 배정 방식"
        className={styles.tabs}
        items={[
          { label: "단일 배정", value: "single" },
          { label: "일괄 배정", value: "bulk" },
        ]}
        onChange={controller.actions.changeAssignmentMode}
        value={controller.assignmentMode}
      />
      <div className={styles.browserModePanel} key={controller.assignmentMode}>
      {controller.assignmentMode === "bulk" ? (
        <VocabAssignmentEntrySelector controller={controller} />
      ) : null}
      <AssignmentWorkspaceFilters controller={controller} />
      {controller.assignmentMode === "bulk" ? (
        <SelectedStudentBasket controller={controller} />
      ) : null}

      {controller.assignmentMode === "bulk" ? (
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
              disabled={!controller.canPrepareBulk}
              onClick={controller.actions.prepareBulkAssignment}
              size="small"
              variant="primary"
            >
              {adminLearningText.page.bulk.prepare}
            </Button>
          </div>
        </div>
      ) : null}

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
      </div>
    </section>
  );
}
