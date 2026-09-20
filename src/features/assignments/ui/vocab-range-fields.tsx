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
  const [filterState, setFilterState] = useState<{ datasetId?: string; filters: ScopeFilters; includeUnclassified?: boolean }>({ filters: EMPTY_SCOPE_FILTERS });
  const filters = filterState.datasetId === dataset?.id ? filterState.filters : EMPTY_SCOPE_FILTERS;
  const tagged = units.some(unit => unit.mockScope);
  const includeUnclassified = filterState.datasetId === dataset?.id ? filterState.includeUnclassified ?? true : true;
  const unclassifiedCount = units.filter(unit => !unit.mockScope).length;
  const visible = tagged ? units.filter(unit => unit.mockScope ? matchesScope(unit.mockScope, filters) : includeUnclassified) : units;
  const hiddenSelected = units.filter(unit => selectedUnitIds.includes(unit.id) && !visible.some(v => v.id === unit.id));
  const originalScopes = [...new Map(units.flatMap(unit => (unit.librarySourceScopes ?? []).map(scope => [scope.id, scope] as const))).values()];
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
        <MockScopeFilters scopes={units.flatMap(unit => unit.mockScope ? [unit.mockScope] : [])} value={filters}
          onChange={next => setFilterState({ datasetId: dataset?.id, filters: next, includeUnclassified })} />
        {unclassifiedCount > 0 ? <label><input type="checkbox" checked={includeUnclassified}
          onChange={e => setFilterState({ datasetId: dataset?.id, filters, includeUnclassified: e.target.checked })} />
          연도·유형 분류가 없는 범위 {unclassifiedCount}개 함께 보기</label> : null}
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
      {originalScopes.length ? <details><summary>원자료 범위로 함께 선택</summary>
        {originalScopes.map(scope => { const members = units.filter(unit => unit.librarySourceScopes?.some(s => s.id === scope.id)); const allSelected = members.every(unit => selectedUnitIds.includes(unit.id));
          return <label key={scope.id}><input type="checkbox" checked={allSelected} onChange={() => { for (const unit of members) if (selectedUnitIds.includes(unit.id) === allSelected) onSelectUnit(unit.id); }} />
            {scope.name} · {members.reduce((n, u) => n + u.entryCount, 0)}개</label>;
        })}
        <p>겹친 부분은 함께 선택되며 실제 단어는 한 번만 포함됩니다.</p>
      </details> : null}
      {dataset && Number.isSafeInteger(dataset.rowCount) ? (
        <p className={styles.questionCountSummary}>단어장 전체 수록 {dataset.rowCount}개 · 선택 범위와 출제 유형에 따라 실제 배정 수는 달라집니다.</p>
      ) : null}
    </div>
  );
}
