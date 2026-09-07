import { isoToKoreanDateTimeLocal } from "@/lib/deadline";
import { resolveVocabUnitCountsForDates, type VocabUnitAllocationRuleV1 } from "@/lib/admin/vocab-unit-allocation";
import { resolveUndatedVocabUnitCycleAllocation, resolveVocabUnitCycleAllocation } from "./vocab-unit-allocation";
import { MAXIMUM_BULK_ASSIGNMENT_COUNT } from "./model";

/** Shared, server-rechecked allocation for both generated and reviewed questions. */
export function resolvePlanUnitAllocation(plan: {
  unitAllocationRule: VocabUnitAllocationRuleV1 | null;
  selectedDateCount: number;
  orderedUnitIds: string[];
  rangeUnitCounts: number[];
  sessions: { unitIds: string[]; availableFrom: string | null; availableUntil: string | null }[];
  recurrenceSessions: { availableFrom: string | null; availableUntil: string | null }[];
  overflowPolicy: "leave" | "continue_weekly";
  extraDatePolicy: "unconfirmed" | "repeat_from_start";
}) {
  const rule = plan.unitAllocationRule;
  if (!rule) throw new Error("회차별 범위 단위 규칙을 확인해 주세요.");
  const immediate = plan.selectedDateCount === 0;
  const dates = immediate ? [] : plan.recurrenceSessions.flatMap(session =>
    session.availableFrom ? [isoToKoreanDateTimeLocal(session.availableFrom).slice(0, 10)] : []);
  if (!immediate && dates.length !== plan.recurrenceSessions.length) {
    throw new Error("범위 단위 배정의 공개 일정을 확인해 주세요.");
  }
  const counts = immediate ? [rule.unitsPerSession] : resolveVocabUnitCountsForDates({ dates, rule });
  if ((immediate && rule.mode !== "same") || JSON.stringify(counts) !== JSON.stringify(plan.rangeUnitCounts)) {
    throw new Error("요일별 단위 수가 원래 반복 일정의 규칙과 일치하지 않습니다.");
  }
  const allocation = immediate
    ? resolveUndatedVocabUnitCycleAllocation({
        orderedUnitIds: plan.orderedUnitIds, unitsPerSession: rule.unitsPerSession,
        maximumSessionCount: MAXIMUM_BULK_ASSIGNMENT_COUNT,
      })
    : resolveVocabUnitCycleAllocation({
        orderedUnitIds: plan.orderedUnitIds, baseSessionUnitCounts: counts,
        selectedDateCount: plan.selectedDateCount, overflowPolicy: plan.overflowPolicy,
        extraDatePolicy: plan.extraDatePolicy, maximumSessionCount: MAXIMUM_BULK_ASSIGNMENT_COUNT,
      });
  if (allocation.issue) throw new Error("범위 단위와 회차 일정을 다시 확인해 주세요.");
  if (JSON.stringify(plan.sessions.map(s => s.unitIds)) !== JSON.stringify(allocation.sessionUnitIds)) {
    throw new Error("회차별 범위가 선택한 순서 또는 단위 수와 일치하지 않습니다.");
  }
  return allocation;
}
