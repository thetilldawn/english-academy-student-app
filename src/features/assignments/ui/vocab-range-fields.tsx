import type { AssignmentDatasetItem } from "../catalog-types";
import type { VocabAssignmentPlannerController } from "../controller/use-vocab-assignment-planner";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";
import { AssignmentDatasetTrigger, type AssignmentDatasetTriggerProps } from "./assignment-dataset-trigger";
import { AssignmentUnitRangePicker } from "./assignment-unit-range-picker";
import styles from "./vocab-assignment-planner.module.css";

export type VocabPlannerFieldsProps = {
  controller: VocabAssignmentPlannerController;
  datasets: readonly AssignmentDatasetItem[];
  fieldErrors?: Partial<Record<VocabAssignmentFieldKey, string>>;
};

export function VocabRangeFields({
  controller,
  datasets,
  fieldErrors = {},
  onOpenDatasetPicker,
  datasetTriggerRef,
}: VocabPlannerFieldsProps & {
  onOpenDatasetPicker: () => void;
  datasetTriggerRef?: AssignmentDatasetTriggerProps["triggerRef"];
}) {
  const datasetError = fieldErrors.dataset;
  const rangeError = fieldErrors.range;

  return (
    <div className={styles.fieldStack}>
      <AssignmentDatasetTrigger
        dataset={datasets.find((dataset) => dataset.id === controller.planner.datasetId)}
        error={datasetError}
        errorId="vocab-dataset-error"
        onOpen={onOpenDatasetPicker}
        triggerRef={datasetTriggerRef}
      />
      <AssignmentUnitRangePicker
        error={rangeError}
        errorId="vocab-range-error"
        onSelect={controller.actions.selectUnit}
        onToggleAll={controller.actions.selectAllUnits}
        selectedUnitIds={controller.selectedUnits.map((unit) => unit.id)}
        units={controller.availableUnits}
      />
    </div>
  );
}
