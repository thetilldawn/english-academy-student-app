import type { AssignmentDatasetItem } from "../catalog-types";
import type { VocabAssignmentPlannerController } from "../controller/use-vocab-assignment-planner";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";
import { buildBulkPlanAudience } from "../presentation/bulk-plan-audience";
import { vocabQuestionView, vocabUnitAllocationView } from "../presentation/vocab-question-view";
import { hasVocabScheduleDates } from "../domain/vocab-schedule";
import type { AssignmentDatasetTriggerProps } from "./assignment-dataset-trigger";
import { VocabQuestionFields } from "./vocab-question-fields";
import { VocabRangeFields } from "./vocab-range-fields";

export { VocabRangeFields } from "./vocab-range-fields";

type VocabPlannerFieldsProps = {
  controller: VocabAssignmentPlannerController;
  datasets: readonly AssignmentDatasetItem[];
  fieldErrors?: Partial<Record<VocabAssignmentFieldKey, string>>;
};

// This is an assembly boundary, not a reusable input component.
export function VocabQuestionSection({ controller, fieldErrors = {} }: Omit<VocabPlannerFieldsProps, "datasets">) {
  const planner = controller.planner;
  const countView = vocabQuestionView({
    audience: buildBulkPlanAudience(controller.bulk.preview),
    capacity: controller.bulk.capacity,
    defaultSessionCount: controller.defaultSessionCount, distribution: controller.distribution,
    assignmentMode: planner.assignmentMode, questionCountMode: planner.questionCountMode,
    manualQuestionCount: planner.manualQuestionCount,
    diagnosticsUnavailable: controller.bulk.preview?.items?.some(item => item.countBreakdown === null),
    previewState: controller.selectedUnits.length === 0 ? "unselected"
      : controller.bulk.preview ? "ready"
      : controller.bulk.previewLoading ? "loading"
      : controller.bulk.state?.preview.status === "error" ? "error" : "blocked",
  });
  const unitView = vocabUnitAllocationView({
    assignmentMode: planner.assignmentMode, scheduleEnabled: hasVocabScheduleDates(planner),
    questionCountMode: planner.questionCountMode,
    defaultSessionCount: controller.defaultSessionCount,
    remainingUnitIds: controller.unitAllocation?.remainingUnitIds ?? [],
    selectedUnits: controller.selectedUnits,
  });
  return <VocabQuestionFields assignmentMode={planner.assignmentMode} questionCountMode={planner.questionCountMode}
    selectionMode={planner.selectionMode} unitsPerSession={planner.unitsPerSession} overflowPolicy={planner.overflowPolicy}
    countView={countView} unitView={unitView}
    fieldErrors={{ questionCount: fieldErrors.questionCount, selectionMode: fieldErrors.selectionMode,
      unitsPerSession: fieldErrors.unitsPerSession, overflowPolicy: fieldErrors.overflowPolicy }}
    onAssignmentModeChange={controller.actions.changeAssignmentMode}
    onSelectionModeChange={controller.actions.changeSelectionMode}
    onUnitsPerSessionChange={controller.actions.changeUnitsPerSession}
    onOverflowPolicyChange={controller.actions.changeOverflowPolicy}
    onRetryCount={controller.bulk.actions?.refreshPreview}
    onActivateManualCount={() => {
      if (countView.manualActivationCount > 0) {
        controller.actions.activateManualQuestionCount(countView.manualActivationCount);
      }
    }}
    onManualCountChange={(value) => {
      controller.actions.activateManualQuestionCount(countView.manualActivationCount);
      controller.actions.changeManualQuestionCount(value);
    }}
    onSelectAllCount={() => controller.actions.changeQuestionCountMode("all")} />;
}

export function VocabRangePicker(props: VocabPlannerFieldsProps & {
  onOpenDatasetPicker: () => void;
  datasetTriggerRef?: AssignmentDatasetTriggerProps["triggerRef"];
}) {
  return (
    <>
      <VocabRangeFields
        dataset={props.datasets.find((dataset) => dataset.id === props.controller.planner.datasetId)}
        units={props.controller.availableUnits}
        selectedUnitIds={props.controller.selectedUnits.map((unit) => unit.id)}
        datasetError={props.fieldErrors?.dataset}
        rangeError={props.fieldErrors?.range}
        onSelectUnit={props.controller.actions.selectUnit}
        onToggleAllUnits={props.controller.actions.selectAllUnits}
        onOpenDatasetPicker={props.onOpenDatasetPicker}
        datasetTriggerRef={props.datasetTriggerRef}
      />
      <VocabQuestionSection controller={props.controller} fieldErrors={props.fieldErrors} />
    </>
  );
}
