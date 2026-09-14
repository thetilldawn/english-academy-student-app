"use client";
import { useState } from "react";
import { MockScopeFilters } from "@/features/wordbook-compositions/public-ui";
import { EMPTY_SCOPE_FILTERS, matchesScope, type ScopeFilters } from "@/features/wordbook-compositions/public-contracts";
import { Button } from "@/design-system/primitives/button/button";

import type { AssignmentDatasetItem, AssignmentUnitItem } from "../catalog-types";
import { AssignmentDatasetTrigger, type AssignmentDatasetTriggerProps } from "./assignment-dataset-trigger";
import { AssignmentUnitRangePicker } from "./assignment-unit-range-picker";
import styles from "./vocab-assignment-planner.module.css";

export type VocabRangeFieldsProps = {
  dataset?: AssignmentDatasetItem;
  units: readonly AssignmentUnitItem[];
  selectedUnitIds: readonly string[];
  datasetError?: string;
  rangeError?: string;
  onSelectUnit: (unitId: string) => void;
  onToggleAllUnits: (selected: boolean) => void;
  onOpenDatasetPicker: () => void;
  datasetTriggerRef?: AssignmentDatasetTriggerProps["triggerRef"];
};

export function VocabRangeFields({
  dataset,
  units,
  selectedUnitIds,
  datasetError,
  rangeError,
  onSelectUnit,
  onToggleAllUnits,
  onOpenDatasetPicker,
  datasetTriggerRef,
}: VocabRangeFieldsProps) {
  const [filterState, setFilterState] = useState<{ datasetId?: string; filters: ScopeFilters }>({ filters: EMPTY_SCOPE_FILTERS });
  const filters = filterState.datasetId === dataset?.id ? filterState.filters : EMPTY_SCOPE_FILTERS;
  const tagged = units.length > 0 && units.every(unit => unit.mockScope);
  const visible = tagged ? units.filter(unit => matchesScope(unit.mockScope!, filters)) : units;
  const hiddenSelected = units.filter(unit => selectedUnitIds.includes(unit.id) && !visible.some(v => v.id === unit.id));
  const toggleVisible = (selected: boolean) => {
    if (!tagged) { onToggleAllUnits(selected); return; }
    for (const unit of visible) if (selectedUnitIds.includes(unit.id) !== selected) onSelectUnit(unit.id);
  };
  return (
    <div className={styles.fieldStack}>
      <AssignmentDatasetTrigger
        dataset={dataset}
        error={datasetError}
        errorId="vocab-dataset-error"
        onOpen={onOpenDatasetPicker}
        triggerRef={datasetTriggerRef}
      />
      {tagged ? <>
        <MockScopeFilters scopes={units.map(unit => unit.mockScope!)} value={filters}
          onChange={next => setFilterState({ datasetId: dataset?.id, filters: next })} />
        <p>총 선택 {selectedUnitIds.length}개 범위 · 아래 전체 선택은 현재 조건의 범위에 적용됩니다.</p>
        {hiddenSelected.length > 0 ? <details><summary>현재 조건에서 보이지 않는 선택 {hiddenSelected.length}개</summary>
          {hiddenSelected.map(unit => <p key={unit.id}>{unit.displayName} <Button size="small" onClick={() => onSelectUnit(unit.id)}>선택 해제</Button></p>)}
        </details> : null}
        {!visible.length ? <p role="status">이 조건에 맞는 범위가 없습니다.</p> : null}
      </> : null}
      <AssignmentUnitRangePicker
        error={rangeError}
        errorId="vocab-range-error"
        onSelect={onSelectUnit}
        onToggleAll={toggleVisible}
        selectedUnitIds={selectedUnitIds}
        units={visible}
      />
      {dataset && Number.isSafeInteger(dataset.rowCount) ? (
        <p className={styles.questionCountSummary}>단어장 전체 수록 {dataset.rowCount}개 · 선택 범위와 출제 유형에 따라 실제 배정 수는 달라집니다.</p>
      ) : null}
    </div>
  );
}
