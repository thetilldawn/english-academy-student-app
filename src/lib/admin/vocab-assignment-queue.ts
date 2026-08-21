export type VocabAssignmentQueueStatus =
  | "active"
  | "attention"
  | "completed"
  | "cancelled";

export type VocabAssignmentQueueItemStatus =
  | "queued"
  | "ready"
  | "assigned"
  | "completed"
  | "attention"
  | "cancelled";

export type VocabAssignmentQueueItem = {
  id: string;
  sequenceNumber: number;
  status: VocabAssignmentQueueItemStatus;
  questionCount: number;
  unitLabels: string[];
  plannedAvailableFrom: string;
  plannedAvailableUntil: string;
  effectiveAvailableFrom: string;
  effectiveAvailableUntil: string;
  assignmentId: string | null;
  attentionReason: string | null;
  materializedAt: string | null;
  completedAt: string | null;
};

export type VocabAssignmentQueueSummary = {
  seriesId: string;
  studentId: string;
  status: VocabAssignmentQueueStatus;
  attentionReason: string | null;
  datasetLabel: string;
  rangeLabel: string;
  totalSessionCount: number;
  completedSessionCount: number;
  remainingSessionCount: number;
  totalQuestionCount: number;
  remainingQuestionCount: number;
  currentAssignmentId: string | null;
  nextAvailableFrom: string | null;
  nextAvailableUntil: string | null;
  items: VocabAssignmentQueueItem[];
  createdAt: string;
  updatedAt: string;
};

export function vocabAssignmentQueueStatusLabel(
  status: VocabAssignmentQueueStatus,
) {
  switch (status) {
    case "active":
      return "이어 배정 중";
    case "attention":
      return "확인 필요";
    case "completed":
      return "완료";
    case "cancelled":
      return "취소";
  }
}

export function vocabAssignmentQueueItemStatusLabel(
  status: VocabAssignmentQueueItemStatus,
) {
  switch (status) {
    case "queued":
      return "대기";
    case "ready":
      return "생성 대기";
    case "assigned":
      return "응시 대기";
    case "completed":
      return "완료";
    case "attention":
      return "확인 필요";
    case "cancelled":
      return "취소";
  }
}

export function vocabAssignmentQueueAttentionLabel(reason: string | null) {
  switch (reason) {
    case "assignment_cancelled":
      return "현재 시험이 취소됨";
    case "assignment_missed":
      return "현재 시험을 미응시함";
    case "assignment_expired":
      return "현재 시험 시간이 끝남";
    case "schedule_conflict":
      return "다음 일정이 다른 시험과 겹침";
    case "schedule_invalid":
      return "다음 시험 일정 확인 필요";
    case "admin_inactive":
      return "최초 배정 관리자 확인 필요";
    case "content_unavailable":
      return "보존한 문항을 현재 자료로 만들 수 없음";
    case "content_release_changed":
      return "단어 자료가 바뀌어 확인 필요";
    case "materialization_failed":
      return "다음 시험 생성 재시도 필요";
    default:
      return reason ? "진행 상태 확인 필요" : null;
  }
}

export function indexVocabAssignmentQueuesByStudent(
  queues: readonly VocabAssignmentQueueSummary[],
) {
  const index = new Map<string, VocabAssignmentQueueSummary[]>();
  for (const queue of queues) {
    const current = index.get(queue.studentId) ?? [];
    current.push(queue);
    index.set(queue.studentId, current);
  }
  return index;
}
