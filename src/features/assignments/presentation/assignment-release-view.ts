import { adminLearningText } from "@/content/ko/admin-learning";
import { formatKoreanDateTime } from "@/lib/format";

export function followUpReleaseLabel(sessionNumber: number, hasPreviousDeadline: boolean) {
  if (sessionNumber <= 1) return null;
  return hasPreviousDeadline ? adminLearningText.assignmentRelease.afterDeadline
    : adminLearningText.assignmentRelease.afterFirst;
}

export function plannedSessionOpeningLabel(sessionNumber: number, availableFrom: string | null) {
  if (availableFrom) return `${sessionNumber > 1 ? "예약 공개" : "공개"} ${formatKoreanDateTime(availableFrom)}`;
  return sessionNumber > 1 ? adminLearningText.assignmentRelease.afterFirst : "바로 공개";
}
