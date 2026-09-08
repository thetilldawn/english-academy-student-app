import { unitRangeDisplayLabel } from "@/lib/admin/unit-range-display";

export function unitRangeLabel(
  units: readonly { label: string }[],
): string | null {
  return unitRangeDisplayLabel(units.map(unit => unit.label));
}

export function unitSelectionLabel(
  units: readonly { label: string; sortIndex: number }[],
): string | null {
  return unitRangeLabel(units);
}
