import { adminLearningText } from "@/content/ko/admin-learning";
import { unitSelectionRangeLabel } from "@/lib/admin/history";
import type { AssignmentUnitItem } from "../catalog-types";

// Metadata counts describe source entries, not unique/eligible exam questions.
export function assignmentSourceWordCount(
  units: readonly Pick<AssignmentUnitItem, "entryCount">[],
) {
  return units.reduce((total, unit) => total + unit.entryCount, 0);
}

export function assignmentRangeSelectionSummary(
  units: readonly Pick<AssignmentUnitItem, "entryCount">[],
) {
  return units.length === 0 ? "시험 범위를 선택해 주세요."
    : `선택한 범위 ${units.length}개 · 수록 단어 ${assignmentSourceWordCount(units).toLocaleString("ko-KR")}개`;
}

export function assignmentUnitRangeLabel(
  labels: readonly string[],
  sortIndexes?: readonly number[],
) {
  if (labels.length === 0) {
    return adminLearningText.assignmentModal.range.rangeMissing;
  }
  return unitSelectionRangeLabel(labels, sortIndexes);
}
