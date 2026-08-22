import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  ActivityRow,
  SelectableRow,
} from "@/design-system/patterns/activity-row/activity-row";
import { ActionWithReason } from "@/design-system/patterns/action-reason/action-reason";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { AssignmentQueueTags } from "@/features/assignment-queue/ui/assignment-queue-tags";
import learningRowStyles from "@/features/history/ui/learning-management-row.module.css";
import {
  assignmentScopeLabel,
} from "@/lib/admin/history";
import { compareAdminHistoryRecency } from "@/features/history/domain/learning-activity";
import { historyDetailHref } from "@/lib/admin/history-route";

import type { AssignmentStudentItem } from "../catalog-types";
import {
  studentActivities,
  type AssignmentWorkspaceController,
} from "../controller/use-assignment-workspace";

export function AssignmentStudentRow({
  controller,
  student,
}: {
  controller: AssignmentWorkspaceController;
  student: AssignmentStudentItem;
}) {
  const activities = studentActivities(controller, student.id);
  const assignmentQueues =
    controller.assignmentQueuesByStudent.get(student.id) ?? [];
  const recentActivity = activities.toSorted(compareAdminHistoryRecency)[0] ?? null;
  const assignmentBlockedReason =
    student.status === "blocked"
      ? "접속 차단 학생"
      : controller.readyDatasets.length === 0
        ? adminLearningText.assignmentModal.submit.blockedReason.noReadyDataset
        : null;
  return (
    <SelectableRow
      actions={
        controller.assignmentMode === "single" ? (
            <ActionWithReason reason={assignmentBlockedReason}>
              <Button
                disabled={assignmentBlockedReason !== null}
                onClick={() =>
                  controller.actions.openSingleAssignment(student.id)
                }
                size="small"
                variant={recentActivity ? "secondary" : "primary"}
              >
                {adminLearningText.page.studentCard.newAssignment}
              </Button>
            </ActionWithReason>
          ) : null
      }
      checked={controller.selectedBulkStudentIds.includes(student.id)}
      checkboxId={`bulk-student-${student.id}`}
      contentHref={recentActivity ? historyDetailHref(recentActivity) : undefined}
      onToggle={() => controller.actions.toggleBulkStudent(student.id)}
      selectionEnabled={controller.assignmentMode === "bulk"}
      disabled={student.status === "blocked"}
      selectionAriaLabel={formatContentText(
        adminLearningText.page.bulk.selectStudentAria,
        { student: student.displayName },
      )}
    >
      <ActivityRow
        main={
          <>
            <span className={learningRowStyles.identity}>
              <strong>{student.displayName}</strong>
              <MetaTagList>
                <MetaTag>
                  {student.schoolName ??
                    adminLearningText.page.studentCard.schoolMissing}
                </MetaTag>
                <MetaTag>
                  {student.gradeLabel ??
                    adminLearningText.page.studentCard.gradeMissing}
                </MetaTag>
              </MetaTagList>
            </span>
            <span className={learningRowStyles.book}>
              <small>현재 단어장</small>
              <strong>
                {student.currentVocabBook ??
                  adminLearningText.page.studentCard.wordbookMissing}
              </strong>
            </span>
            {assignmentQueues.slice(0, 1).map((queue) => (
              <AssignmentQueueTags compact key={queue.seriesId} queue={queue} />
            ))}
            {assignmentQueues.length > 1 ? (
              <MetaTagList>
                <MetaTag>이어 배정 외 {assignmentQueues.length - 1}개</MetaTag>
              </MetaTagList>
            ) : null}
            <span className={learningRowStyles.recent}>
              {recentActivity ? (
                <>
                  <small>최근 시험 범위</small>
                  <strong>{assignmentScopeLabel(recentActivity)}</strong>
                </>
              ) : (
                <strong>{adminLearningText.page.studentCard.noActivity}</strong>
              )}
            </span>
          </>
        }
      />
    </SelectableRow>
  );
}
