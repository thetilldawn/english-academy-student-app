import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  ActivityRow,
  SelectableRow,
} from "@/design-system/patterns/activity-row/activity-row";
import { ActionWithReason } from "@/design-system/patterns/action-reason/action-reason";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import type { StudentDirectoryListItem } from "@/features/students/public-contracts";
import { formatKoreanDateTime } from "@/lib/format";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import styles from "./assignment-workspace.module.css";

export function AssignmentStudentRow({
  controller,
  student,
}: {
  controller: AssignmentWorkspaceController;
  student: StudentDirectoryListItem;
}) {
  const assignmentBlockedReason = student.status === "blocked"
    ? "접속 차단 학생"
    : null;
  return (
    <SelectableRow
      actions={
        controller.assignmentMode === "single" ? (
          <ActionWithReason reason={assignmentBlockedReason}>
            <Button
              disabled={assignmentBlockedReason !== null}
              onClick={() => controller.actions.openSingleAssignment(student.id)}
              size="small"
              variant="primary"
            >
              {adminLearningText.page.studentCard.newAssignment}
            </Button>
          </ActionWithReason>
        ) : null
      }
      checked={controller.selectedBulkStudentIds.includes(student.id)}
      checkboxId={`bulk-student-${student.id}`}
      disabled={student.status === "blocked" || controller.selectionLoading}
      onToggle={() => controller.actions.toggleBulkStudent(student)}
      selectionAriaLabel={formatContentText(
        adminLearningText.page.bulk.selectStudentAria,
        { student: student.displayName },
      )}
      selectionEnabled={controller.assignmentMode === "bulk"}
    >
      <ActivityRow
        main={
          <div className={styles.studentRowSummary}>
            <span className={styles.studentIdentity}>
              <strong>{student.displayName}</strong>
              <MetaTagList>
                <MetaTag>
                  {student.schoolName ?? adminLearningText.page.studentCard.schoolMissing}
                </MetaTag>
                <MetaTag>
                  {student.gradeLabel ?? adminLearningText.page.studentCard.gradeMissing}
                </MetaTag>
              </MetaTagList>
            </span>
            <span className={styles.studentBook}>
              <small>현재 단어장</small>
              <strong>
                {student.currentVocabBook ?? adminLearningText.page.studentCard.wordbookMissing}
              </strong>
            </span>
            <span className={styles.studentRecentExam}>
              <small>최근 시험</small>
              <strong>
                {student.recentExamAt
                  ? formatKoreanDateTime(student.recentExamAt)
                  : "시험 없음"}
              </strong>
            </span>
            <MetaTagList>
              <MetaTag>완료 {student.completedCount}</MetaTag>
              <MetaTag>미응시 {student.missedCount}</MetaTag>
              <MetaTag>응시 전 {student.notStartedCount}</MetaTag>
            </MetaTagList>
          </div>
        }
      />
    </SelectableRow>
  );
}
