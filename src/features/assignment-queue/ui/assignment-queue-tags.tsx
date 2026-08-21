import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import {
  vocabAssignmentQueueAttentionLabel,
  vocabAssignmentQueueStatusLabel,
  type VocabAssignmentQueueSummary,
} from "@/lib/admin/vocab-assignment-queue";

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
  queue,
}: {
  queue: VocabAssignmentQueueSummary;
}) {
  const attention = vocabAssignmentQueueAttentionLabel(queue.attentionReason);
  return (
    <MetaTagList aria-label="이어 배정 상태">
      <MetaTag tone={statusTone(queue.status)}>
        {vocabAssignmentQueueStatusLabel(queue.status)}
      </MetaTag>
      <MetaTag>{queue.datasetLabel}</MetaTag>
      <MetaTag>{queue.rangeLabel}</MetaTag>
      <MetaTag>
        전체 {queue.totalSessionCount}회 중 {queue.remainingSessionCount}회 남음
      </MetaTag>
      <MetaTag>{queue.remainingQuestionCount}문항 남음</MetaTag>
      {attention ? <MetaTag tone="warning">{attention}</MetaTag> : null}
    </MetaTagList>
  );
}
