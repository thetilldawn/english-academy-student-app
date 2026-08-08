import type {
  AssignmentActivityStatus,
  AssignmentHistorySummary,
} from "@/lib/admin/history";
import {
  activityPassed,
  learningActivityEffectiveAt,
} from "@/lib/admin/learning-activity";

export type StudentVocabBookHistory = {
  studentId: string;
  datasetId: string;
  datasetTitle: string;
  lastScopeLabel: string;
  lastActivityAt: string;
  lastStatus: Extract<
    AssignmentActivityStatus,
    "in_progress" | "completed" | "expired"
  >;
  lastPassed: boolean;
  attemptCount: number;
};

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function scopeLabel(labels: string[]) {
  if (labels.length === 0) return "범위 정보 없음";
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels.at(-1)}`;
}

function progressLabels(
  item: AssignmentHistorySummary,
  unitDisplayNameById: ReadonlyMap<string, string>,
) {
  const unitIds =
    item.assignmentPurpose === "mixed" || item.primaryUnitIds.length > 0
      ? item.primaryUnitIds
      : item.unitIds;
  const fallbackLabels =
    item.assignmentPurpose === "mixed" || item.primaryUnitLabels.length > 0
      ? item.primaryUnitLabels
      : item.unitLabels;
  if (unitIds.length === 0) return fallbackLabels;
  return unitIds.map(
    (unitId, index) =>
      unitDisplayNameById.get(unitId) ??
      fallbackLabels[index] ??
      "범위 정보 없음",
  );
}

export function buildStudentVocabBookHistory(
  history: readonly AssignmentHistorySummary[],
  unitDisplayNameById: ReadonlyMap<string, string> = new Map(),
): StudentVocabBookHistory[] {
  const eligible = history.filter(
    (item): item is AssignmentHistorySummary & {
      attemptId: string;
      status: "in_progress" | "completed" | "expired";
    } =>
      item.attemptId !== null &&
      item.assignmentPurpose !== "review" &&
      ["in_progress", "completed", "expired"].includes(item.status),
  );
  const groups = new Map<string, typeof eligible>();

  for (const item of eligible) {
    const key = `${item.studentId}\u0000${item.datasetId}`;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((items) => {
      const sorted = items.toSorted(
        (left, right) =>
          timestamp(learningActivityEffectiveAt(right)) -
          timestamp(learningActivityEffectiveAt(left)),
      );
      const latest = sorted[0];
      return {
        studentId: latest.studentId,
        datasetId: latest.datasetId,
        datasetTitle: latest.datasetTitle,
        lastScopeLabel: scopeLabel(
          progressLabels(latest, unitDisplayNameById),
        ),
        lastActivityAt: learningActivityEffectiveAt(latest),
        lastStatus: latest.status,
        lastPassed: activityPassed(latest),
        attemptCount: new Set(items.map((item) => item.attemptId)).size,
      };
    })
    .toSorted(
      (left, right) =>
        timestamp(right.lastActivityAt) - timestamp(left.lastActivityAt),
    );
}
