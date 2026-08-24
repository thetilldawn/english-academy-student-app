import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import {
  Field,
  FieldLabel,
  Select,
} from "@/design-system/primitives/form/field";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
  groupCataloguedUnits,
} from "@/lib/admin/dataset-catalog";
import { newAssignmentDefaultUnitIds } from "@/lib/admin/new-assignment-range";
import { selectInclusiveUnitRange } from "@/lib/admin/unit-range";
import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import type {
  AssignmentDatasetItem,
  AssignmentProgressItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import { assignmentUnitRangeLabel } from "../presentation/assignment-unit-range-label";
import { AssignmentCapacitySummary } from "./assignment-capacity-summary";
import styles from "./single-assignment-editor.module.css";

export function AssignmentRangeFields({
  controller,
  datasets,
  progress,
  units,
}: {
  controller: SingleAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  progress: AssignmentProgressItem | null;
  units: readonly AssignmentUnitItem[];
}) {
  const { actions, capacity, isExactReview, state } = controller;
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
  const unitGroups = groupCataloguedUnits(datasetUnits);
  const startUnitId = draft.range.orderedUnitIds[0] ?? "";
  const endUnitId = draft.range.orderedUnitIds.at(-1) ?? startUnitId;
  const selectedUnits = draft.range.orderedUnitIds.flatMap((unitId) => {
    const unit = datasetUnits.find((candidate) => candidate.id === unitId);
    return unit ? [unit] : [];
  });
  const usesDayLabels =
    datasetUnits.length > 0 &&
    datasetUnits.every((unit) => unit.kind === "day");
  const unitTerm = usesDayLabels
    ? adminLearningText.assignmentModal.range.dayTerm
    : adminLearningText.assignmentModal.range.unitTerm;
  const selectedLabels = selectedUnits.map((unit) => unit.displayName);
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
    const orderedUnitIds =
      recommendedUnitIds.length > 0
        ? recommendedUnitIds
        : nextUnits[0]
          ? [nextUnits[0].id]
          : [];
    actions.changeRange(datasetId, orderedUnitIds);
  }

  function changeBoundary(startId: string, endId: string) {
    actions.changeRange(
      draft.range.datasetId,
      selectInclusiveUnitRange(datasetUnits, startId, endId).map(
        (unit) => unit.id,
      ),
    );
  }

  return (
    <>
      {isExactReview ? (
        <Notice>
          {adminLearningText.assignmentModal.edit.lockedReview}
        </Notice>
      ) : null}
      <Field as="label">
        <FieldLabel as="span">
          {adminLearningText.assignmentModal.range.wordbook}
        </FieldLabel>
        <Select
          disabled={isExactReview}
          onChange={(event) => changeDataset(event.target.value)}
          required
          value={draft.range.datasetId}
        >
          <option disabled value="">
            {adminLearningText.assignmentModal.range.selectWordbook}
          </option>
          {selectedDataset &&
          !readyDatasets.some((dataset) => dataset.id === selectedDataset.id) ? (
            <option disabled value={selectedDataset.id}>
              {cataloguedDatasetDisplayLabel(selectedDataset)} ·{" "}
              {adminLearningText.assignmentModal.range.assignmentClosed}
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
      </Field>
      <AssignmentFieldGrid>
        <Field as="label">
          <FieldLabel as="span">
            {formatContentText(adminLearningText.assignmentModal.range.start, {
              unit: unitTerm,
            })}
          </FieldLabel>
          <Select
            disabled={isExactReview}
            onChange={(event) =>
              changeBoundary(event.target.value, endUnitId || event.target.value)
            }
            required
            value={startUnitId}
          >
            <option disabled value="">
              {formatContentText(
                adminLearningText.assignmentModal.range.selectStart,
                { unit: unitTerm },
              )}
            </option>
            {unitGroups.map((group) => (
              <optgroup
                key={group.group ?? "range"}
                label={
                  group.label ??
                  adminLearningText.assignmentModal.range.groupFallback
                }
              >
                {group.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {formatContentText(
                      adminLearningText.assignmentModal.range.unitEntryCount,
                      { count: unit.entryCount, unit: unit.displayName },
                    )}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field as="label">
          <FieldLabel as="span">
            {formatContentText(adminLearningText.assignmentModal.range.end, {
              unit: unitTerm,
            })}
          </FieldLabel>
          <Select
            disabled={isExactReview}
            onChange={(event) =>
              changeBoundary(startUnitId || event.target.value, event.target.value)
            }
            required
            value={endUnitId}
          >
            <option disabled value="">
              {formatContentText(
                adminLearningText.assignmentModal.range.selectEnd,
                { unit: unitTerm },
              )}
            </option>
            {unitGroups.map((group) => (
              <optgroup
                key={group.group ?? "range"}
                label={
                  group.label ??
                  adminLearningText.assignmentModal.range.groupFallback
                }
              >
                {group.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {formatContentText(
                      adminLearningText.assignmentModal.range.unitEntryCount,
                      { count: unit.entryCount, unit: unit.displayName },
                    )}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </AssignmentFieldGrid>
      <p className={styles.selectionSummary}>
        {formatContentText(
          adminLearningText.assignmentModal.range.sourceWordCount,
          {
            count: sourceWordCount.toLocaleString(),
            range: assignmentUnitRangeLabel(
              selectedLabels,
              selectedUnits.map((unit) => unit.sortIndex),
            ),
          },
        )}
      </p>
      <AssignmentCapacitySummary
        capacity={capacity}
        exactReview={isExactReview}
        sourceWordCount={sourceWordCount}
      />
    </>
  );
}
