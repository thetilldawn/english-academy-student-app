import { adminLearningText } from "@/content/ko/admin-learning";
import { unitSelectionRangeLabel } from "@/lib/admin/history";

export function assignmentUnitRangeLabel(
  labels: readonly string[],
  sortIndexes?: readonly number[],
) {
  if (labels.length === 0) {
    return adminLearningText.assignmentModal.range.rangeMissing;
  }
  return unitSelectionRangeLabel(labels, sortIndexes);
}
