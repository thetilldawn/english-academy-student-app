import type { QueueResolutionResult } from "../api/queue-actions";
import { vocabAssignmentQueueAttentionLabel, type VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

export function queueAttentionView(queue: VocabAssignmentQueueSummary) {
  const item = [...queue.items].sort((a, b) => a.sequenceNumber - b.sequenceNumber).find(item => item.status === "attention");
  if (!item) return null;
  const waiting = queue.items.filter(next => next.sequenceNumber > item.sequenceNumber && next.status === "queued").length;
  const reason = vocabAssignmentQueueAttentionLabel(item.attentionReason ?? queue.attentionReason) ?? "진행 상태 확인 필요";
  return `${item.sequenceNumber}회차 · ${reason}. 뒤에서 ${waiting}회가 기다리고 있습니다.`;
}

export function queueResolutionView(result: QueueResolutionResult) {
  const item = result.queue.items.find(item => item.id === result.resolution.item_id);
  if (!item) return { warning: true, message: "처리한 회차를 확인하지 못했습니다. 최신 내역을 확인해 주세요." };
  const attention = queueAttentionView(result.queue);
  const prefix = `${item.sequenceNumber}회차`;
  const action = result.resolution.action;
  const schedule = (from: string, until: string) => `${isoToKoreanDateTimeLocal(from).replace("T", " ")} ~ ${isoToKoreanDateTimeLocal(until).replace("T", " ")}`;
  if (action === "cancel" && result.queue.status === "cancelled") {
    return { warning: false, message: `${prefix}부터 남은 시험을 취소했습니다. 완료·보류 기록은 남습니다.` };
  }
  if (action === "retry" && item.status === "assigned") {
    return { warning: Boolean(attention), message: `${prefix}를 다시 배정했습니다. 새 일정: ${schedule(item.effectiveAvailableFrom, item.effectiveAvailableUntil)}${attention ? ". " + attention : ""}` };
  }
  if (action === "skip" && item.status === "deferred") {
    const next = [...result.queue.items].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .find(next => next.sequenceNumber > item.sequenceNumber && ["assigned", "ready", "queued"].includes(next.status));
    return { warning: Boolean(attention), message: `${prefix}를 보류했습니다. ` + (attention ?? (next
      ? `${next.sequenceNumber}회차 일정: ${schedule(next.effectiveAvailableFrom, next.effectiveAvailableUntil)}`
      : "이어서 배정할 회차가 없습니다.")) };
  }
  return { warning: true, message: `${prefix} 처리가 완료되지 않았습니다. ${attention ?? "최신 내역을 확인해 주세요."}` };
}
