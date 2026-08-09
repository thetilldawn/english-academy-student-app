import {
  resolveOrderedContiguousUnits,
  type OrderedUnit,
} from "@/lib/admin/unit-range";

export const bulkAssignmentRangeModes = [
  "single",
  "previous_span",
  "week_span",
] as const;

export type BulkAssignmentRangeMode =
  (typeof bulkAssignmentRangeModes)[number];

export type BulkRangeProgress = {
  recommendedUnitIds: readonly string[];
  recommendedDirection: 1 | -1;
};

export type ResolvedBulkAssignmentRange<T extends OrderedUnit> = {
  units: T[];
  requestedCount: number;
  truncated: boolean;
};

export function resolveBulkAssignmentRange<T extends OrderedUnit>(
  availableUnits: readonly T[],
  progress: BulkRangeProgress,
  mode: BulkAssignmentRangeMode,
): ResolvedBulkAssignmentRange<T> {
  const recommended = resolveOrderedContiguousUnits(
    availableUnits,
    progress.recommendedUnitIds,
  );
  const requestedCount =
    mode === "single"
      ? 1
      : mode === "week_span"
        ? 7
        : recommended.length;
  const direction =
    mode === "previous_span"
      ? recommended.length > 1 &&
        recommended[1].sortIndex < recommended[0].sortIndex
        ? -1
        : progress.recommendedDirection
      : progress.recommendedDirection;
  const unitBySortIndex = new Map(
    availableUnits.map((unit) => [unit.sortIndex, unit]),
  );
  const units: T[] = [];
  for (let offset = 0; offset < requestedCount; offset += 1) {
    const unit = unitBySortIndex.get(
      recommended[0].sortIndex + offset * direction,
    );
    if (!unit) break;
    units.push(unit);
  }

  return {
    units,
    requestedCount,
    truncated: units.length < requestedCount,
  };
}

export function unitRangeLabel(
  units: readonly { label: string }[],
): string | null {
  if (units.length === 0) return null;
  if (units.length === 1) return units[0].label;
  return `${units[0].label}~${units.at(-1)!.label}`;
}
