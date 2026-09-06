import type { AssignmentUnitItem } from "../catalog-types";
import type { VocabAssignmentMode, VocabRangeDistribution } from "../domain/vocab-assignment-contract";
import { assignmentUnitRangeLabel } from "./assignment-unit-range-label";
import type { BulkPlanAudience } from "./bulk-plan-audience";

export type VocabQuestionView = { countSummary: string; manualActivationCount: number; manualCountValue: number | "" };
export type VocabUnitAllocationView = { visible: boolean; showUnitsPerSession: boolean; showOverflow: boolean; summary: string | null };

export function vocabQuestionView(input: {
  audience: BulkPlanAudience;
  defaultSessionCount: number;
  distribution: VocabRangeDistribution;
  assignmentMode: VocabAssignmentMode;
  questionCountMode: "all" | "manual";
  manualQuestionCount: number;
}): VocabQuestionView {
  const reference = input.audience.reference;
  const availableQuestionCount = reference?.availableQuestionCount ?? null;
  const defaultSessionCount = reference?.defaultSessionCount ?? input.defaultSessionCount ?? 0;
  const selectedQuestionCount = reference?.selectedQuestionCount ?? 0;
  const remainingQuestionCount = reference?.remainingQuestionCount ?? 0;
  const countSummary = input.audience.totalCount > 1 && !reference
    ? "학생별 계획을 마지막 미리보기에서 확인해 주세요."
    : availableQuestionCount === null
    ? "범위와 단어 수를 정하면 기본 회차를 계산합니다."
    : input.distribution === "repeat"
      ? `전체 ${availableQuestionCount}개 · 배정 ${selectedQuestionCount}개 · 남음 ${remainingQuestionCount}개 · 회차당 ${selectedQuestionCount}개`
      : input.assignmentMode === "per_session"
        ? `전체 ${availableQuestionCount}개 · 범위별 배정 · 기본 ${defaultSessionCount}회`
        : `전체 ${availableQuestionCount}개 · 배정 ${selectedQuestionCount}개 · 남음 ${remainingQuestionCount}개 · 기본 ${defaultSessionCount}회`;
  return {
    countSummary,
    manualActivationCount: availableQuestionCount === null ? 0 : Math.min(500, availableQuestionCount),
    manualCountValue: input.questionCountMode === "manual" || input.manualQuestionCount > 0
      ? input.manualQuestionCount : availableQuestionCount ?? "",
  };
}

export function vocabUnitAllocationView(input: {
  assignmentMode: VocabAssignmentMode;
  scheduleEnabled: boolean | undefined;
  defaultSessionCount: number;
  remainingUnitIds: readonly string[];
  selectedUnits: readonly Pick<AssignmentUnitItem, "id" | "label" | "sortIndex">[];
}): VocabUnitAllocationView {
  const usesRangeUnits = input.assignmentMode === "per_session";
  const unitsById = new Map(input.selectedUnits.map((unit) => [unit.id, unit]));
  const remainingUnits = input.remainingUnitIds.flatMap((id) => {
    const unit = unitsById.get(id); return unit ? [unit] : [];
  });
  const remainingRangeLabel = remainingUnits.length === 0 ? "" : assignmentUnitRangeLabel(
    remainingUnits.map((unit) => unit.label), remainingUnits.map((unit) => unit.sortIndex));
  return {
    visible: usesRangeUnits || input.assignmentMode === "word_count",
    showUnitsPerSession: usesRangeUnits,
    showOverflow: input.scheduleEnabled !== false,
    summary: usesRangeUnits ? `기본 ${input.defaultSessionCount}회` + (input.remainingUnitIds.length > 0
      ? ` · 남음 ${remainingRangeLabel} (${input.remainingUnitIds.length}단위)` : "") : null,
  };
}
