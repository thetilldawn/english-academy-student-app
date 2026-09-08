import { AssignmentSessionRow } from "./assignment-editor-fields";
import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { AssignmentSessionReleaseTags } from "./assignment-session-release-tags";
import { unitRangeDisplayGroups } from "@/lib/admin/unit-range-display";

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
              {session.unitLabels.length > 0
                ? unitRangeDisplayGroups(session.unitLabels).map((group, index) => <MetaTag key={index}>{group.label}</MetaTag>)
                : <span>{adminLearningText.bulkAssignmentModal.rangePending}</span>}
              {session.rangeTruncated ? (
                <MetaTag size="large" tone="warning">
                  {adminLearningText.bulkAssignmentModal.availableRangeOnly}
                </MetaTag>
              ) : null}
            </MetaTagList>
          }
          error={session.error ? <small>{session.error}</small> : null}
          heading={<MetaTagList><strong>{session.sessionNumber}회차</strong>
              <MetaTag tone={session.available ? "success" : "danger"}>
                {session.available
                  ? formatContentText(
                      adminLearningText.bulkAssignmentModal.questionCount,
                      { count: session.questionCount },
                    )
                  : adminLearningText.bulkAssignmentModal.needsReview}
              </MetaTag>
            </MetaTagList>}
          timeline={<AssignmentSessionReleaseTags sessionNumber={session.sessionNumber} availableFrom={session.availableFrom} availableUntil={session.availableUntil} />}
          key={`${item.studentId}-${session.sessionNumber}`}
        />
      ))}
    </div>
  );
}
