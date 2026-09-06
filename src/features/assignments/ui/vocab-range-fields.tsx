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
  return (
    <div className={styles.fieldStack}>
      <AssignmentDatasetTrigger
        dataset={dataset}
        error={datasetError}
        errorId="vocab-dataset-error"
        onOpen={onOpenDatasetPicker}
        triggerRef={datasetTriggerRef}
      />
      <AssignmentUnitRangePicker
        error={rangeError}
        errorId="vocab-range-error"
        onSelect={onSelectUnit}
        onToggleAll={onToggleAllUnits}
        selectedUnitIds={selectedUnitIds}
        units={units}
      />
    </div>
  );
}
