import {
  resolveOrderedContiguousUnits,
  type OrderedUnit,
} from "@/lib/admin/unit-range";

export const bulkAssignmentRangeModes = [
  "previous_span",
  "fixed_span",
] as const;

export const MAXIMUM_BULK_ASSIGNMENT_COUNT = 210;
export const MAXIMUM_BULK_STUDENT_COUNT = 210;

export type BulkAssignmentRangeMode =
  (typeof bulkAssignmentRangeModes)[number];

export type BulkRangeProgress = {
  recommendedUnitIds: readonly string[];
  recommendedDirection: 1 | -1;
};

export type ResolvedBulkAssignmentSession<T extends OrderedUnit> = {
  sessionNumber: number;
  units: T[];
  requestedCount: number;
  truncated: boolean;
};

export type ResolvedBulkAssignmentSeries<T extends OrderedUnit> = {
  direction: 1 | -1;
  requestedCountPerSession: number;
  sessions: ResolvedBulkAssignmentSession<T>[];
  hasEmptySession: boolean;
};

export function resolveBulkAssignmentSeries<T extends OrderedUnit>(
  availableUnits: readonly T[],
  progress: BulkRangeProgress,
  mode: BulkAssignmentRangeMode,
  unitsPerSession: number,
  sessionCount: number,
): ResolvedBulkAssignmentSeries<T> {
  const recommended = resolveOrderedContiguousUnits(
    availableUnits,
    progress.recommendedUnitIds,
  );
  const requestedCountPerSession =
    mode === "previous_span" ? recommended.length : unitsPerSession;
  const direction =
    mode === "previous_span" &&
    recommended.length > 1 &&
    recommended[1].sortIndex < recommended[0].sortIndex
      ? -1
      : progress.recommendedDirection;
  const unitBySortIndex = new Map(
    availableUnits.map((unit) => [unit.sortIndex, unit]),
  );
  const firstSortIndex = recommended[0].sortIndex;
  const sessions = Array.from({ length: sessionCount }, (_, index) => {
    const units: T[] = [];
    const sessionStart =
      firstSortIndex + index * requestedCountPerSession * direction;
    for (let offset = 0; offset < requestedCountPerSession; offset += 1) {
      const unit = unitBySortIndex.get(
        sessionStart + offset * direction,
      );
      if (!unit) break;
      units.push(unit);
    }
    return {
      sessionNumber: index + 1,
      units,
      requestedCount: requestedCountPerSession,
      truncated: units.length > 0 && units.length < requestedCountPerSession,
    };
  });

  return {
    direction,
    requestedCountPerSession,
    sessions,
    hasEmptySession: sessions.some((session) => session.units.length === 0),
  };
}

export function unitRangeLabel(
  units: readonly { label: string }[],
): string | null {
  if (units.length === 0) return null;
  if (units.length === 1) return units[0].label;
  return `${units[0].label}~${units.at(-1)!.label}`;
}
