import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import {
  vocabAssignmentQueueAttentionLabel,
  vocabAssignmentQueueStatusLabel,
  vocabAssignmentQueueUnitAllocationLabel,
  type VocabAssignmentQueueSummary,
} from "@/lib/admin/vocab-assignment-queue";

import styles from "./assignment-queue-tags.module.css";

function statusTone(status: VocabAssignmentQueueSummary["status"]) {
  switch (status) {
    case "active":
      return "success" as const;
    case "attention":
      return "warning" as const;
    case "completed":
      return "neutral" as const;
    case "cancelled":
      return "danger" as const;
  }
}

export function AssignmentQueueTags({
  compact = false,
  queue,
}: {
  compact?: boolean;
  queue: VocabAssignmentQueueSummary;
}) {
  const attention = vocabAssignmentQueueAttentionLabel(queue.attentionReason);
  const unitAllocation = vocabAssignmentQueueUnitAllocationLabel(
    queue.unitAllocation,
  );
  if (compact) {
    return (
      <span aria-label="배정된 시험 상태" className={styles.compact}>
        <MetaTag tone={statusTone(queue.status)}>
          {vocabAssignmentQueueStatusLabel(queue.status)}
        </MetaTag>
        <span className={styles.summary}>
          {queue.datasetLabel} · {queue.rangeLabel}
          {unitAllocation ? ` · ${unitAllocation}` : ""}
          {` · ${queue.remainingSessionCount}회 · ${queue.remainingQuestionCount}개 남음`}
        </span>
        {attention ? (
          <span className={styles.attention}>{attention}</span>
        ) : null}
      </span>
    );
  }

  return (
    <MetaTagList aria-label="배정된 시험 상태">
      <MetaTag tone={statusTone(queue.status)}>
        {vocabAssignmentQueueStatusLabel(queue.status)}
      </MetaTag>
      <MetaTag>{queue.datasetLabel}</MetaTag>
      <MetaTag>{queue.rangeLabel}</MetaTag>
      {unitAllocation ? <MetaTag>{unitAllocation}</MetaTag> : null}
      <MetaTag>
        전체 {queue.totalSessionCount}회 중 {queue.remainingSessionCount}회 남음
      </MetaTag>
      <MetaTag>{queue.remainingQuestionCount}개 남음</MetaTag>
      {attention ? <MetaTag tone="warning">{attention}</MetaTag> : null}
    </MetaTagList>
  );
}
