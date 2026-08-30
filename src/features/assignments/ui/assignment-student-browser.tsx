import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { Notice } from "@/design-system/patterns/feedback/feedback";
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
  const directory = controller.directory;
  const students = directory.snapshot.page.items;
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
              <Button
                disabled={
                  controller.selectionLoading ||
                  directory.filtering ||
                  controller.filters.status !== "active" ||
                  directory.snapshot.totalCount === 0
                }
                onClick={() => void controller.actions.toggleFilteredStudents()}
                size="small"
                variant="quiet"
              >
                {controller.selectionLoading
                  ? "학생 확인 중…"
                  : controller.allFilteredStudentsSelected
                    ? "필터 결과 선택 해제"
                    : `필터 결과 ${directory.snapshot.totalCount}명 선택`}
              </Button>
              {controller.selectedBulkStudentIds.length > 0 ? (
                <Button
                  disabled={controller.selectionLoading}
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

        {controller.selectionError ? (
          <Notice role="alert" tone="danger">{controller.selectionError}</Notice>
        ) : null}
        {directory.error ? (
          <Notice role="alert" tone="danger">{directory.error}</Notice>
        ) : null}

        {students.length === 0 && !directory.filtering ? (
          <div className={styles.empty} role="status">
            {adminLearningText.page.noStudents}
          </div>
        ) : (
          <div
            aria-busy={directory.filtering}
            className={styles.studentList}
          >
            {students.map((student) => (
              <AssignmentStudentRow
                controller={controller}
                key={student.id}
                student={student}
              />
            ))}
          </div>
        )}
        {directory.snapshot.page.nextCursor ? (
          <div className={styles.loadMoreRow}>
            <Button
              disabled={directory.loadingMore || directory.filtering}
              onClick={() => void controller.actions.loadMore()}
              variant="secondary"
            >
              {directory.loadingMore ? "불러오는 중…" : "10명 더보기"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
