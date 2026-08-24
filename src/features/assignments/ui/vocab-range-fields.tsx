import {
  Field,
  FieldError,
  FieldLabel,
  Select,
} from "@/design-system/primitives/form/field";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
} from "@/lib/admin/dataset-catalog";

import type { AssignmentDatasetItem } from "../catalog-types";
import type { VocabAssignmentPlannerController } from "../controller/use-vocab-assignment-planner";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";
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
}: VocabPlannerFieldsProps) {
  const selectedIds = new Set(controller.selectedUnits.map((unit) => unit.id));
  const groups = groupCataloguedDatasets(datasets);
  const datasetError = fieldErrors.dataset;
  const rangeError = fieldErrors.range;

  return (
    <div className={styles.fieldStack}>
      <Field as="label">
        <FieldLabel as="span">단어장</FieldLabel>
        <Select
          aria-errormessage={datasetError ? "vocab-dataset-error" : undefined}
          aria-invalid={Boolean(datasetError)}
          data-field-key="dataset"
          onChange={(event) => controller.actions.changeDataset(event.target.value)}
          value={controller.planner.datasetId}
        >
          <option disabled value="">
            단어장 선택
          </option>
          {groups.map((group) => (
            <optgroup key={group.group} label={group.label}>
              {group.datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {cataloguedDatasetDisplayLabel(dataset)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {datasetError ? (
          <FieldError id="vocab-dataset-error">{datasetError}</FieldError>
        ) : null}
      </Field>
      <AssignmentUnitRangePicker
        error={rangeError}
        errorId="vocab-range-error"
        onSelect={controller.actions.selectUnit}
        onToggleAll={controller.actions.selectAllUnits}
        selectedUnitIds={selectedIds}
        units={controller.availableUnits}
      />
    </div>
  );
}
