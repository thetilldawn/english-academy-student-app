import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";

import type { AssignmentCapacityResponse } from "../api/response-adapters";
import styles from "./single-assignment-editor.module.css";

export function AssignmentCapacitySummary({
  capacity,
  exactReview,
  sourceWordCount,
}: {
  capacity: AssignmentCapacityResponse | null;
  exactReview: boolean;
  sourceWordCount: number;
}) {
  if (exactReview) return null;
  if (!capacity) {
    return (
      <p aria-busy="true" aria-live="polite" className={styles.capacitySummary}>
        <span>문항 계산 중…</span>
      </p>
    );
  }
  return (
    <p aria-live="polite" className={styles.capacitySummary}>
      <span>
        {formatContentText(
          adminLearningText.assignmentModal.range.eligibleWordCount,
          { count: capacity.eligibleBeforeActiveAssignment.toLocaleString() },
        )}
      </span>
      {sourceWordCount > capacity.eligibleBeforeActiveAssignment ? (
        <span>
          {formatContentText(
            adminLearningText.assignmentModal.range.sourceExcluded,
            {
              count: (
                sourceWordCount - capacity.eligibleBeforeActiveAssignment
              ).toLocaleString(),
            },
          )}
        </span>
      ) : null}
      {capacity.activeAssignmentExcluded > 0 ? (
        <span>
          {formatContentText(
            adminLearningText.assignmentModal.range.activeAssignmentExcluded,
            { count: capacity.activeAssignmentExcluded.toLocaleString() },
          )}
        </span>
      ) : null}
      {capacity.questionPlanExcluded > 0 ? (
        <span>
          {formatContentText(
            adminLearningText.assignmentModal.range.questionPlanExcluded,
            { count: capacity.questionPlanExcluded.toLocaleString() },
          )}
        </span>
      ) : null}
      <strong>
        {formatContentText(
          adminLearningText.assignmentModal.range.maximumQuestionCount,
          { count: capacity.maximumQuestionCount.toLocaleString() },
        )}
      </strong>
      {capacity.activeAssignmentExcluded > 0 ? (
        <HelpTip
          label={
            adminLearningText.assignmentModal.range.activeAssignmentHelpAria
          }
          trigger="제외 기준"
        >
          {adminLearningText.assignmentModal.range.activeAssignmentHelp}
        </HelpTip>
      ) : null}
    </p>
  );
}
