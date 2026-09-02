import "server-only";

import { createHash } from "node:crypto";

import {
  ISO_WEEKDAYS,
  type VocabSplitOverflowPolicy,
  type VocabUnitAllocationRuleV1,
} from "@/lib/admin/vocab-unit-allocation";

export type ResolvedBulkPlanDigestItem = {
  studentId: string;
  datasetId: string | null;
  sessions: ReadonlyArray<{
    sessionNumber: number;
    sourceSessionNumber: number;
    cycleIndex: number;
    unitIds: readonly string[];
    questionCount: number;
    availableFrom: string | null;
    availableUntil: string | null;
    targets: ReadonlyArray<{
      id: number;
      direction: "english_to_korean" | "korean_to_english";
      questionItemId?: string;
      questionItemSha256?: string;
    }>;
  }>;
};

export type ResolvedBulkPlanSourceContext = {
  questionMode?:
    | "book_meaning_choice"
    | "canonical_definition_to_headword"
    | "canonical_example_to_headword";
  canonicalReleaseId?: string | null;
  canonicalPackageSha256?: string | null;
  distribution: "split" | "repeat";
  splitBasis: "question_count" | "range_unit";
  orderedUnitIds: readonly string[];
  rangeUnitCounts: readonly number[];
  unitAllocationRule: VocabUnitAllocationRuleV1 | null;
  questionCount:
    | { mode: "all" }
    | { mode: "manual"; value: number };
  overflowPolicy: VocabSplitOverflowPolicy;
  extraDatePolicy: "unconfirmed" | "repeat_from_start";
  selectedDateCount: number;
  selectionMode: "source_order" | "random";
  recurrenceSessions: ReadonlyArray<{
    availableFrom: string | null;
    availableUntil: string | null;
  }>;
};

function canonicalSourceContext(
  sourceContext: ResolvedBulkPlanSourceContext | null,
) {
  if (!sourceContext) return null;
  const rule = sourceContext.unitAllocationRule;
  return {
    questionMode: sourceContext.questionMode ?? "book_meaning_choice",
    canonicalReleaseId: sourceContext.canonicalReleaseId ?? null,
    canonicalPackageSha256: sourceContext.canonicalPackageSha256 ?? null,
    distribution: sourceContext.distribution,
    splitBasis: sourceContext.splitBasis,
    orderedUnitIds: [...sourceContext.orderedUnitIds],
    rangeUnitCounts: [...sourceContext.rangeUnitCounts],
    unitAllocationRule: rule
      ? {
          schemaVersion: rule.schemaVersion,
          mode: rule.mode,
          unitsPerSession: rule.unitsPerSession,
          weekdayUnitsPerSession: ISO_WEEKDAYS.map((isodow) => ({
            isodow,
            unitCount: rule.weekdayUnitsPerSession[isodow],
          })),
        }
      : null,
    questionCount: sourceContext.questionCount,
    overflowPolicy: sourceContext.overflowPolicy,
    extraDatePolicy: sourceContext.extraDatePolicy,
    selectedDateCount: sourceContext.selectedDateCount,
    selectionMode: sourceContext.selectionMode,
    recurrenceSessions: sourceContext.recurrenceSessions.map((session) => ({
      availableFrom: session.availableFrom,
      availableUntil: session.availableUntil,
    })),
  };
}

/**
 * Binds a Preview response to the exact student, range, schedule, target word,
 * and direction plan that the save request must reproduce.
 */
export function resolvedBulkPlanSha256(
  items: readonly ResolvedBulkPlanDigestItem[],
  sourceContext: ResolvedBulkPlanSourceContext | null = null,
) {
  const canonical = items
    .map((item) => ({
      studentId: item.studentId,
      datasetId: item.datasetId,
      sessions: item.sessions
        .map((session) => ({
          sessionNumber: session.sessionNumber,
          sourceSessionNumber: session.sourceSessionNumber,
          cycleIndex: session.cycleIndex,
          unitIds: [...session.unitIds],
          questionCount: session.questionCount,
          availableFrom: session.availableFrom,
          availableUntil: session.availableUntil,
          targets: session.targets.map((target) => ({
            id: target.id,
            direction: target.direction,
            questionItemId: target.questionItemId ?? null,
            questionItemSha256: target.questionItemSha256 ?? null,
          })),
        }))
        .toSorted((left, right) => left.sessionNumber - right.sessionNumber),
    }))
    .toSorted((left, right) => left.studentId.localeCompare(right.studentId));

  return createHash("sha256")
    .update(JSON.stringify({
      canonical,
      sourceContext: canonicalSourceContext(sourceContext),
    }), "utf8")
    .digest("hex");
}
