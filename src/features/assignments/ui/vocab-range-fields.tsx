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
import { DayRangeRail } from "./day-range-rail";
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
  const selectedLabel = controller.selectedUnits.length === 0
    ? "범위를 선택하세요"
    : controller.selectedUnits.length === 1
      ? controller.selectedUnits[0]!.label
      : `${controller.selectedUnits[0]!.label} → ${controller.selectedUnits.at(-1)!.label}`;
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
      <div
        aria-describedby={rangeError ? "vocab-range-error" : undefined}
        aria-label="시험 범위 선택"
        data-field-key="range"
        role="group"
        tabIndex={-1}
      >
        <DayRangeRail
          onSelect={controller.actions.selectUnit}
          selectedUnitIds={selectedIds}
          selection={controller.planner.range}
          units={controller.availableUnits}
        />
        <span className={styles.rangeSummary}>{selectedLabel}</span>
        {rangeError ? (
          <FieldError id="vocab-range-error">{rangeError}</FieldError>
        ) : null}
      </div>
    </div>
  );
}
