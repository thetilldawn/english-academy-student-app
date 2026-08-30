import { AssignmentSessionRow } from "./assignment-editor-fields";
import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { formatKoreanDateTime } from "@/lib/format";

import type { BulkAssignmentPreviewResponse } from "../api/response-adapters";
import styles from "./vocab-assignment-form.module.css";

type PreviewItem = BulkAssignmentPreviewResponse["items"][number];

export function BulkPreviewSessionList({
  completionGated = false,
  item,
}: {
  completionGated?: boolean;
  item: PreviewItem;
}) {
  if (item.sessions.length === 0) {
    return (
      <span className={styles.pending}>
        {item.error ?? adminLearningText.bulkAssignmentModal.rangePending}
      </span>
    );
  }

  return (
    <div className={styles.sessionList}>
      {item.sessions.map((session) => (
        <AssignmentSessionRow
          className={styles.sessionRow}
          details={
            <MetaTagList>
              <MetaTag size="large">
                {session.unitLabel ??
                  adminLearningText.bulkAssignmentModal.rangePending}
              </MetaTag>
              <MetaTag size="large">
                {session.availableFrom
                  ? formatContentText(
                      adminLearningText.bulkAssignmentModal.assignmentDateTag,
                      { datetime: formatKoreanDateTime(session.availableFrom) },
                    )
                  : "바로 공개"}
              </MetaTag>
              {session.availableUntil ? (
                <MetaTag size="large">
                  {formatContentText(
                    adminLearningText.bulkAssignmentModal.deadlineTag,
                    { datetime: formatKoreanDateTime(session.availableUntil) },
                  )}
                </MetaTag>
              ) : null}
              {session.rangeTruncated ? (
                <MetaTag size="large" tone="warning">
                  {adminLearningText.bulkAssignmentModal.availableRangeOnly}
                </MetaTag>
              ) : null}
              <MetaTag size="large" tone={session.available ? "success" : "danger"}>
                {session.available
                  ? formatContentText(
                      adminLearningText.bulkAssignmentModal.questionCount,
                      { count: session.questionCount },
                    )
                  : adminLearningText.bulkAssignmentModal.needsReview}
              </MetaTag>
              {completionGated && session.sessionNumber > 1 ? (
                <MetaTag size="large">완료 후 생성</MetaTag>
              ) : null}
            </MetaTagList>
          }
          error={session.error ? <small>{session.error}</small> : null}
          heading={<strong>{session.sessionNumber}회차</strong>}
          key={`${item.studentId}-${session.sessionNumber}`}
        />
      ))}
    </div>
  );
}
