export function unitRangeLabel(
  units: readonly { label: string }[],
): string | null {
  if (units.length === 0) return null;
  if (units.length === 1) return units[0].label;
  return `${units[0].label}~${units.at(-1)!.label}`;
}

export function unitSelectionLabel(
  units: readonly { label: string; sortIndex: number }[],
): string | null {
  if (units.length < 2) return unitRangeLabel(units);
  const direction = Math.sign(units[1]!.sortIndex - units[0]!.sortIndex);
  const contiguous = Math.abs(direction) === 1 && units.every(
    (unit, index) =>
      index === 0 ||
      unit.sortIndex - units[index - 1]!.sortIndex === direction,
  );
  return contiguous
    ? unitRangeLabel(units)
    : `${units[0]!.label} 외 ${units.length - 1}개`;
}
