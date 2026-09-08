import { Button } from "@/design-system/primitives/button/button";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { unitRangeDisplayGroups } from "@/lib/admin/unit-range-display";
import {
  FieldError,
  FieldLabel,
} from "@/design-system/primitives/form/field";

import type { AssignmentUnitItem } from "../catalog-types";
import { resolveVocabUnitSelection } from "../domain/vocab-planner-controls";
import { assignmentRangeSelectionSummary } from "../presentation/assignment-unit-range-label";
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
  selectedUnitIds: readonly string[];
  units: readonly AssignmentUnitItem[];
}) {
  const selectedUnits = resolveVocabUnitSelection(units, {
    selectedUnitIds,
  });
  const selectedUnitIdSet = new Set(selectedUnits.map((unit) => unit.id));
  const allSelected = units.length > 0 && selectedUnits.length === units.length;
  const selectedRanges = unitRangeDisplayGroups(selectedUnits.map(unit => unit.label));

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
      {selectedUnits.length > 0 || !error ? <div className={styles.rangeSelectionSummary} aria-live="polite" aria-atomic="true">
        <strong>{assignmentRangeSelectionSummary(selectedUnits)}</strong>
        <MetaTagList>{selectedRanges.map((range, index) => <MetaTag key={index}>{range.label}</MetaTag>)}</MetaTagList>
      </div> : null}
      <DayRangeRail
        disabled={disabled}
        onSelect={onSelect}
        selectedUnitIds={selectedUnitIdSet}
        units={units}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
