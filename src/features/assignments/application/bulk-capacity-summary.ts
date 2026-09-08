import type { BulkAssignmentPreviewResponse } from "../api/response-adapters";
import type { BulkSeriesAssignmentDraft } from "../domain/model";
import { incompleteAssignmentNumberIssues } from "../domain/validation";

export type BulkCapacitySummary = {
  status: "ready" | "different" | "unavailable";
  totalAvailableQuestionCount: number | null;
  maximumSessionQuestionCount: number | null;
  defaultSessionCount: number | null;
};

// Display-only identity: dates never stand in for a validated submission plan.
// Keep just one current scope, not a cache of students or previous previews.
export function bulkCapacityIdentity(draft: BulkSeriesAssignmentDraft): string | null {
  if (incompleteAssignmentNumberIssues(draft).length > 0) return null;
  const plan = draft.commonPlan;
  if (!plan || draft.studentIds.length === 0) return null;
  return JSON.stringify({
    studentIds: [...draft.studentIds].sort(),
    questionMode: draft.questionMode,
    exam: draft.exam,
    datasetId: plan.datasetId,
    orderedUnitIds: plan.orderedUnitIds,
    distribution: plan.distribution,
    splitBasis: plan.splitBasis,
    questionCount: plan.questionCount,
    unitAllocationRule: plan.unitAllocationRule,
    // Old weekday-specific rules can change capacity when dates change.
    rangeUnitCounts: plan.unitAllocationRule?.mode === "same" ? null : plan.rangeUnitCounts,
    overflowPolicy: plan.overflowPolicy,
    selectionMode: plan.selectionMode,
    planNonce: plan.planNonce,
  });
}

const unavailable: BulkCapacitySummary = {
  status: "unavailable",
  totalAvailableQuestionCount: null,
  maximumSessionQuestionCount: null,
  defaultSessionCount: null,
};

export function summarizeBulkCapacity(
  preview: BulkAssignmentPreviewResponse,
  draft: BulkSeriesAssignmentDraft,
): BulkCapacitySummary {
  const { items } = preview;
  if (!draft.commonPlan || items.length === 0 ||
      JSON.stringify(items.map(item => item.studentId).sort()) !==
        JSON.stringify([...draft.studentIds].sort()) ||
      items.some(item => item.datasetId !== draft.commonPlan?.datasetId ||
        item.error !== null || item.availableQuestionCount === null ||
        item.defaultSessionCount === null)) {
    return unavailable;
  }
  // A successful capacity calculation may have no selected dates/sessions yet.
  // item.available describes assignment readiness, not whether this count exists.
  const values = items.map(item => ({
    totalAvailableQuestionCount: item.totalAvailableQuestionCount ?? null,
    maximumSessionQuestionCount: item.maximumSessionQuestionCount ?? null,
    defaultSessionCount: item.defaultSessionCount,
  }));
  const first = values[0]!;
  if (values.some(value => JSON.stringify(value) !== JSON.stringify(first))) {
    return { ...unavailable, status: "different" };
  }
  return { status: "ready", ...first };
}
