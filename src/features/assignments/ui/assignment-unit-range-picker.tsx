import { Button } from "@/design-system/primitives/button/button";
import {
  FieldError,
  FieldLabel,
} from "@/design-system/primitives/form/field";

import type { AssignmentUnitItem } from "../catalog-types";
import { assignmentUnitRangeLabel } from "../presentation/assignment-unit-range-label";
import { DayRangeRail } from "./day-range-rail";
import styles from "./vocab-assignment-planner.module.css";

export function AssignmentUnitRangePicker({
  disabled = false,
  error,
  errorId = "assignment-range-error",
  fieldKey = "range",
  onSelect,
  onToggleAll,
  selectedUnitIds,
  units,
}: {
  disabled?: boolean;
  error?: string;
  errorId?: string;
  fieldKey?: string;
  onSelect: (unitId: string) => void;
  onToggleAll: (selected: boolean) => void;
  selectedUnitIds: ReadonlySet<string>;
  units: readonly AssignmentUnitItem[];
}) {
  const selectedUnits = units.filter((unit) => selectedUnitIds.has(unit.id));
  const allSelected = units.length > 0 && selectedUnits.length === units.length;
  const selectedLabel = selectedUnits.length === 0
    ? "범위를 선택하세요"
    : assignmentUnitRangeLabel(
        selectedUnits.map((unit) => unit.label),
        selectedUnits.map((unit) => unit.sortIndex),
      );

  return (
    <div
      aria-describedby={error ? errorId : undefined}
      aria-label="시험 범위 선택"
      data-field-key={fieldKey}
      role="group"
      tabIndex={-1}
    >
      <div className={styles.rangeControlHeading}>
        <FieldLabel as="span">범위</FieldLabel>
        <Button
          aria-pressed={allSelected}
          disabled={disabled || units.length === 0}
          onClick={() => onToggleAll(!allSelected)}
          size="small"
          variant="filter"
        >
          {allSelected ? "전체 해제" : "전체 선택"}
        </Button>
      </div>
      <DayRangeRail
        disabled={disabled}
        onSelect={onSelect}
        selectedUnitIds={selectedUnitIds}
        units={units}
      />
      <span className={styles.rangeSummary}>
        {selectedLabel}
        {selectedUnits.length > 0 ? ` · ${selectedUnits.length}개 선택` : ""}
      </span>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
