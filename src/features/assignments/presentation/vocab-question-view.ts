import type { AssignmentUnitItem } from "../catalog-types";
import type { VocabAssignmentMode, VocabRangeDistribution } from "../domain/vocab-assignment-contract";
import { resolveVocabAssignmentMode, vocabContinueWeeklyDisabledReason } from "../domain/vocab-assignment-contract";
import { assignmentUnitRangeLabel } from "./assignment-unit-range-label";
import type { BulkPlanAudience } from "./bulk-plan-audience";
import type { BulkCapacitySummary } from "../application/bulk-capacity-summary";

export type VocabQuestionView = { countSummary: string; allCountLabel: string; canRetry: boolean; manualActivationCount: number; manualCountValue: number | "" };
export type VocabUnitAllocationView = { visible: boolean; showUnitsPerSession: boolean; showOverflow: boolean; continueWeeklyDisabledReason: string | null; summary: string | null };

export function vocabQuestionView(input: {
  audience: BulkPlanAudience;
  defaultSessionCount: number | null;
  capacity?: BulkCapacitySummary | null;
  distribution: VocabRangeDistribution;
  assignmentMode: VocabAssignmentMode;
  questionCountMode: "all" | "manual";
  manualQuestionCount: number;
  previewState: "unselected" | "loading" | "blocked" | "error" | "ready";
  diagnosticsUnavailable?: boolean;
}): VocabQuestionView {
  // Retained capacity never supplies assigned counts or submission readiness.
  const reference = input.previewState === "ready" ? input.audience.reference : null;
  const capacity = (input.previewState === "ready" || input.previewState === "loading") &&
      input.capacity?.status === "ready" ? input.capacity : null;
  const availableQuestionCount = capacity?.totalAvailableQuestionCount ??
    reference?.totalAvailableQuestionCount ??
    (input.distribution === "split" ? reference?.availableQuestionCount : null) ?? null;
  const maximumSessionQuestionCount = capacity?.maximumSessionQuestionCount ??
    reference?.maximumSessionQuestionCount ??
    (input.distribution === "repeat" ? reference?.availableQuestionCount : null) ?? null;
  const defaultSessionCount = capacity?.defaultSessionCount ??
    reference?.defaultSessionCount ?? input.defaultSessionCount;
  const selectedQuestionCount = reference?.selectedQuestionCount ?? 0;
  const countSummary = input.previewState === "unselected"
    ? "시험 범위를 선택해 주세요."
    : input.capacity?.status === "different" &&
      (input.previewState === "ready" || input.previewState === "loading")
    ? "학생별 출제 가능 단어 수와 회차가 다릅니다. 아래 미리보기에서 확인해 주세요."
    : capacity && !reference
    ? [
        availableQuestionCount === null ? "전체 가능 단어 수는 다시 확인해 주세요." : `한 번씩 나눌 때 출제 가능 ${availableQuestionCount}개`,
        maximumSessionQuestionCount === null ? null : `회차당 최대 ${maximumSessionQuestionCount}개`,
        defaultSessionCount === null ? null : `가능한 배정 ${defaultSessionCount}회`,
        input.previewState === "loading" ? "일정을 다시 확인하는 중입니다." : null,
      ].filter(Boolean).join(" · ")
    : input.previewState === "loading"
    ? "출제 가능 단어 수를 확인하는 중입니다."
    : input.previewState === "error"
    ? "출제 가능 단어 수를 확인하지 못했습니다. 다시 시도해 주세요."
    : input.previewState === "blocked"
    ? "출제 가능 단어 수는 배정 조건을 정한 뒤 확인할 수 있습니다."
    : input.audience.totalCount > 1 && !reference
    ? "학생별 출제 가능 수는 마지막 미리보기에서 확인해 주세요."
    : availableQuestionCount === null
    ? maximumSessionQuestionCount !== null
      ? `회차당 최대 ${maximumSessionQuestionCount}개 · 전체 가능 단어 수는 다시 확인해 주세요.`
      : "출제 가능 단어 수를 확인하지 못했습니다. 아래 미리보기 안내를 확인해 주세요."
    : input.distribution === "repeat"
      ? `한 번씩 나눌 때 출제 가능 ${availableQuestionCount}개 · 회차당 최대 ${maximumSessionQuestionCount ?? 500}개 · 회차당 배정 ${selectedQuestionCount}개`
      : input.assignmentMode === "per_session"
        ? `한 번씩 나눌 때 출제 가능 ${availableQuestionCount}개 · 범위별 배정 · 기본 ${defaultSessionCount}회`
        : `한 번씩 나눌 때 출제 가능 ${availableQuestionCount}개 · 기본 ${defaultSessionCount}회`;
  const hasExceptions = reference !== null && input.audience.separateCount > 0;
  return {
    countSummary: hasExceptions
      ? `공통 ${input.audience.sameCount}명 · 학생 1명 기준 · ${countSummary} · 다른 ${input.audience.separateCount}명은 아래 미리보기에서 확인해 주세요.`
      : (input.audience.totalCount > 1 && reference ? "학생 1명 기준 · " : "") + countSummary + (reference?.scheduledQuestionCount != null
        ? ` · 이번 배정 합계 ${reference.scheduledQuestionCount}문항 (반복 포함)` : ""),
    allCountLabel: availableQuestionCount === null ? "전체 사용"
      : hasExceptions ? "전체 사용 · 학생별 확인" : `전체 사용 · ${availableQuestionCount}개`,
    canRetry: input.previewState === "error" ||
      (input.previewState === "ready" && input.diagnosticsUnavailable === true),
    manualActivationCount: input.manualQuestionCount > 0 ? input.manualQuestionCount
      : availableQuestionCount === null ? 0 : Math.min(500, maximumSessionQuestionCount ?? 500, availableQuestionCount),
    manualCountValue: input.questionCountMode === "manual" || input.manualQuestionCount > 0
      ? input.manualQuestionCount : availableQuestionCount === null ? ""
        : Math.min(500, maximumSessionQuestionCount ?? 500, availableQuestionCount),
  };
}

export function vocabUnitAllocationView(input: {
  assignmentMode: VocabAssignmentMode;
  questionCountMode: "all" | "manual";
  scheduleEnabled: boolean | undefined;
  defaultSessionCount: number | null;
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
    continueWeeklyDisabledReason: vocabContinueWeeklyDisabledReason({
      ...resolveVocabAssignmentMode(input.assignmentMode),
      questionCount: { mode: input.questionCountMode },
    }),
    summary: usesRangeUnits ? (input.defaultSessionCount === null
      ? "범위와 회차당 단위 수를 정해 주세요." : `기본 ${input.defaultSessionCount}회`) + (input.remainingUnitIds.length > 0
      ? ` · 남음 ${remainingRangeLabel} (${input.remainingUnitIds.length}단위)` : "") : null,
  };
}
