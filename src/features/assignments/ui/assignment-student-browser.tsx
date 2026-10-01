import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { adminStudentsText } from "@/content/ko/admin-students";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { Button } from "@/design-system/primitives/button/button";
import { Tabs } from "@/design-system/primitives/tabs/tabs";
import { StableDataRegion } from "@/design-system/patterns/route-state/stable-data-region";
import type { ReactNode } from "react";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import { AssignmentStudentRow } from "./assignment-student-row";
import { AssignmentWorkspaceFilters } from "./assignment-workspace-filters";
import { SelectedStudentBasket } from "./selected-student-basket";
import { VocabAssignmentEntrySelector } from "./vocab-assignment-entry-selector";
import styles from "./assignment-workspace.module.css";

export function AssignmentStudentBrowser({
  controller,
  onNotebook,
  privateDataVisible = true,
  pendingContent,
}: {
  controller: AssignmentWorkspaceController;
  onNotebook?: (students: { id: string; displayName: string }[], audienceMode: "single" | "bulk") => void;
  privateDataVisible?: boolean;
  pendingContent?: ReactNode;
}) {
  const directory = controller.directory;
  const students = directory.snapshot.page.items;
  return (
    <section aria-label="단어 시험 대상 선택" className={styles.browser}>
      <div inert={!privateDataVisible || undefined}>
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
          <VocabAssignmentEntrySelector controller={controller} privateDataVisible={privateDataVisible} />
        ) : null}
        <AssignmentWorkspaceFilters
          classGroupOptions={controller.classGroupOptions}
          filters={controller.filters}
          gradeOptions={controller.gradeOptions}
          onClearSearch={controller.actions.clearSearch}
          onResetFilters={controller.actions.resetFilters}
          onSetFilter={controller.actions.setFilter}
          schoolOptions={controller.schoolOptions}
          totalCount={controller.directory.snapshot.totalCount}
          wordbookOptions={controller.wordbookOptions}
          privateDataVisible={privateDataVisible}
        />
        {controller.assignmentMode === "bulk" ? (
          <SelectedStudentBasket students={privateDataVisible ? controller.selectedBulkStudents : []} busy={controller.selectionLoading} onClear={controller.actions.clearBulkStudents} onToggle={controller.actions.toggleBulkStudent} />
        ) : null}

        {controller.assignmentMode === "bulk" ? (
          <div className={styles.bulkBar}>
            <div className={styles.bulkSummary}>
              <strong>
                {formatContentText(adminLearningText.page.bulk.selectedCount, {
                  count: privateDataVisible ? controller.selectedBulkStudentIds.length : "—",
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
                {!privateDataVisible ? "필터 결과 선택" : controller.selectionLoading
                  ? "학생 확인 중…"
                  : controller.allFilteredStudentsSelected
                    ? "필터 결과 선택 해제"
                    : `필터 결과 ${directory.snapshot.totalCount}명 선택`}
              </Button>
            </div>
            <div className={styles.bulkActions}>
              {onNotebook ? <Button disabled={controller.selectionLoading || controller.selectedBulkStudents.length === 0} onClick={() => onNotebook(controller.selectedBulkStudents, "bulk")} size="small">개인 오답 배정</Button> : null}
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
        </div>
      </div>
      <StableDataRegion pending={!privateDataVisible} fallback={pendingContent ?? <p role="status">접속을 확인하고 있습니다.</p>}>
        {pendingContent}
        {controller.selectionError ? (
          <Notice role="alert" tone="danger">{controller.selectionError}</Notice>
        ) : null}
        {directory.error ? (
          <Notice role="alert" tone="danger">
            {directory.error}
            <Button onClick={() => void directory.actions.reloadFirstPage()} variant="quiet">
              {adminStudentsText.page.retry}
            </Button>
          </Notice>
        ) : null}

        {students.length === 0 && !directory.filtering && !directory.error ? (
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
                assignmentMode={controller.assignmentMode}
                checked={controller.selectedBulkStudentIds.includes(student.id)}
                key={student.id}
                onAssign={controller.actions.openSingleAssignment}
                onNotebook={onNotebook ? student => onNotebook([student], "single") : undefined}
                onToggle={controller.actions.toggleBulkStudent}
                selectionLoading={controller.selectionLoading}
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
      </StableDataRegion>
    </section>
  );
}
