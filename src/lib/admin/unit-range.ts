export type OrderedUnit = {
  id: string;
  sortIndex: number;
};

export type PlannedUnitRange<T extends OrderedUnit> = {
  units: T[];
  direction: 1 | -1;
  requestedCount: number;
  truncated: boolean;
};

export function selectInclusiveUnitRange<T extends OrderedUnit>(
  availableUnits: readonly T[],
  startUnitId: string,
  endUnitId: string,
): T[] {
  const sorted = [...availableUnits].sort(
    (left, right) => left.sortIndex - right.sortIndex,
  );
  const startIndex = sorted.findIndex((unit) => unit.id === startUnitId);
  const endIndex = sorted.findIndex((unit) => unit.id === endUnitId);
  if (startIndex < 0 || endIndex < 0) return [];

  const selected = sorted.slice(
    Math.min(startIndex, endIndex),
    Math.max(startIndex, endIndex) + 1,
  );
  return startIndex <= endIndex ? selected : selected.reverse();
}

export function resolveOrderedContiguousUnits<T extends OrderedUnit>(
  availableUnits: readonly T[],
  unitIds: readonly string[],
): T[] {
  if (unitIds.length < 1 || new Set(unitIds).size !== unitIds.length) {
    throw new Error("선택한 단원 범위가 올바르지 않습니다.");
  }

  const availableById = new Map(
    availableUnits.map((unit) => [unit.id, unit]),
  );
  const selected = unitIds.flatMap((unitId) => {
    const unit = availableById.get(unitId);
    return unit ? [unit] : [];
  });
  if (selected.length !== unitIds.length) {
    throw new Error("선택한 단원을 사용할 수 없습니다.");
  }
  if (selected.length === 1) return selected;

  const direction = selected[1].sortIndex - selected[0].sortIndex;
  if (
    Math.abs(direction) !== 1 ||
    selected.some(
      (unit, index) =>
        index > 0 &&
        unit.sortIndex - selected[index - 1].sortIndex !== direction,
    )
  ) {
    throw new Error("선택한 단원은 한 방향의 연속 범위여야 합니다.");
  }
  return selected;
}

export function planNextUnitRange<T extends OrderedUnit>(
  availableUnits: readonly T[],
  previousUnitIds: readonly string[],
): PlannedUnitRange<T> | null {
  let previousUnits: T[];
  try {
    previousUnits = resolveOrderedContiguousUnits(
      availableUnits,
      previousUnitIds,
    );
  } catch {
    return null;
  }

  const direction: 1 | -1 =
    previousUnits.length > 1 &&
    previousUnits[1].sortIndex < previousUnits[0].sortIndex
      ? -1
      : 1;
  const unitBySortIndex = new Map(
    availableUnits.map((unit) => [unit.sortIndex, unit]),
  );
  const nextUnits: T[] = [];
  const nextStartSortIndex =
    previousUnits.at(-1)!.sortIndex + direction;
  for (let offset = 0; offset < previousUnits.length; offset += 1) {
    const unit = unitBySortIndex.get(
      nextStartSortIndex + offset * direction,
    );
    if (!unit) break;
    nextUnits.push(unit);
  }

  return {
    units: nextUnits,
    direction,
    requestedCount: previousUnits.length,
    truncated: nextUnits.length > 0 && nextUnits.length < previousUnits.length,
  };
}
