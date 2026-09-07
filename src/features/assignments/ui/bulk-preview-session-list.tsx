import { AssignmentSessionRow } from "./assignment-editor-fields";
import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { AssignmentSessionReleaseTags } from "./assignment-session-release-tags";

import type { BulkAssignmentPreviewResponse } from "../api/response-adapters";
import styles from "./vocab-assignment-form.module.css";

type PreviewItem = BulkAssignmentPreviewResponse["items"][number];

export function BulkPreviewSessionList({
  item,
}: {
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
              <AssignmentSessionReleaseTags
                sessionNumber={session.sessionNumber}
                availableFrom={session.availableFrom}
                availableUntil={session.availableUntil}
              />
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
