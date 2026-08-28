import { adminLearningText } from "@/content/ko/admin-learning";
import {
  Field,
  FieldError,
  FieldLabel,
  Select,
} from "@/design-system/primitives/form/field";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
} from "@/lib/admin/dataset-catalog";
import { newAssignmentDefaultUnitIds } from "@/lib/admin/new-assignment-range";

import type {
  AssignmentDatasetItem,
  AssignmentProgressItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import type { AssignmentEditFieldErrors } from "../presentation/assignment-edit-field-errors";
import { AssignmentCapacitySummary } from "./assignment-capacity-summary";
import { AssignmentUnitRangePicker } from "./assignment-unit-range-picker";

export function AssignmentRangeFields({
  controller,
  datasets,
  fieldErrors = {},
  progress,
  units,
}: {
  controller: SingleAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  fieldErrors?: AssignmentEditFieldErrors;
  progress: AssignmentProgressItem | null;
  units: readonly AssignmentUnitItem[];
}) {
  const { actions, capacity, fieldPolicy, isExactReview, state } = controller;
  const draft = state.draft;
  const readyDatasets = datasets.filter(
    (dataset) =>
      dataset.status === "ready" && dataset.isActive && dataset.isAssignable,
  );
  const readyDatasetGroups = groupCataloguedDatasets(readyDatasets);
  const selectedDataset = datasets.find(
    (dataset) => dataset.id === draft.range.datasetId,
  );
  const datasetUnits = units
    .filter((unit) => unit.datasetId === draft.range.datasetId)
    .toSorted((left, right) => left.sortIndex - right.sortIndex);
  const selectedUnitIds = new Set(draft.range.orderedUnitIds);
  const selectedUnits = datasetUnits.filter((unit) => selectedUnitIds.has(unit.id));
  const sourceWordCount = selectedUnits.reduce(
    (total, unit) => total + unit.entryCount,
    0,
  );

  function changeDataset(datasetId: string) {
    const nextUnits = units
      .filter((unit) => unit.datasetId === datasetId)
      .toSorted((left, right) => left.sortIndex - right.sortIndex);
    const recommendedUnitIds = newAssignmentDefaultUnitIds(
      progress,
      datasetId,
    ).filter((unitId) => nextUnits.some((unit) => unit.id === unitId));
    const orderedUnitIds = recommendedUnitIds.length > 0
      ? recommendedUnitIds
      : nextUnits[0]
        ? [nextUnits[0].id]
        : [];
    actions.changeRange(datasetId, orderedUnitIds);
  }

  function toggleUnit(unitId: string) {
    const nextSelected = new Set(selectedUnitIds);
    if (nextSelected.has(unitId)) nextSelected.delete(unitId);
    else nextSelected.add(unitId);
    actions.changeRange(
      draft.range.datasetId,
      datasetUnits
        .filter((unit) => nextSelected.has(unit.id))
        .map((unit) => unit.id),
    );
  }

  function toggleAll(selected: boolean) {
    actions.changeRange(
      draft.range.datasetId,
      selected ? datasetUnits.map((unit) => unit.id) : [],
    );
  }

  return (
    <>
      {isExactReview ? (
        <Notice>{adminLearningText.assignmentModal.edit.lockedReview}</Notice>
      ) : null}
      <Field as="label" data-field-key="dataset" tabIndex={-1}>
        <FieldLabel as="span">단어장</FieldLabel>
        <Select
          aria-errormessage={fieldErrors.dataset ? "edit-dataset-error" : undefined}
          aria-invalid={Boolean(fieldErrors.dataset)}
          disabled={fieldPolicy.dataset !== "editable"}
          onChange={(event) => changeDataset(event.target.value)}
          required
          value={draft.range.datasetId}
        >
          <option disabled value="">단어장 선택</option>
          {selectedDataset &&
          !readyDatasets.some((dataset) => dataset.id === selectedDataset.id) ? (
            <option disabled value={selectedDataset.id}>
              {cataloguedDatasetDisplayLabel(selectedDataset)} · 배정 종료
            </option>
          ) : null}
          {readyDatasetGroups.map((group) => (
            <optgroup key={group.group} label={group.label}>
              {group.datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {cataloguedDatasetDisplayLabel(dataset)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {fieldErrors.dataset ? (
          <FieldError id="edit-dataset-error">
            {fieldErrors.dataset}
          </FieldError>
        ) : null}
      </Field>
      <AssignmentUnitRangePicker
        disabled={fieldPolicy.range !== "editable"}
        error={fieldErrors.range}
        errorId="edit-range-error"
        onSelect={toggleUnit}
        onToggleAll={toggleAll}
        selectedUnitIds={selectedUnitIds}
        units={datasetUnits}
      />
      <AssignmentCapacitySummary
        capacity={capacity}
        exactReview={isExactReview}
        sourceWordCount={sourceWordCount}
      />
    </>
  );
}
