import { adminLearningText } from "@/content/ko/admin-learning";

export function assignmentUnitRangeLabel(labels: readonly string[]) {
  if (labels.length === 0) {
    return adminLearningText.assignmentModal.range.rangeMissing;
  }
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels.at(-1)}`;
}
