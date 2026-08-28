import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import type { AssignmentEditFieldErrors } from "../presentation/assignment-edit-field-errors";
import { AssignmentAvailabilityFields } from "./assignment-availability-fields";
import { AssignmentDeadlineFields } from "./assignment-deadline-fields";
import { AssignmentWordCountField } from "./assignment-word-count-field";
import {
  ExamConditionFields,
  ExamQuestionOrderField,
} from "./bulk-exam-fields";
import { ExamTimingFields } from "./exam-timing-fields";

export function AssignmentSettingsFields({
  controller,
  fieldErrors = {},
  fieldIdPrefix,
  part,
}: {
  controller: SingleAssignmentController;
  fieldErrors?: AssignmentEditFieldErrors;
  fieldIdPrefix: string;
  part: "conditions" | "schedule";
}) {
  const {
    actions,
    capacity,
    fieldPolicy,
    minimumQuestionCount,
    state,
  } = controller;
  const { draft } = state;
  const seriesItem =
    draft.operation.mode === "replace" &&
    draft.operation.seriesItem === true;
  const scheduleMemoryKey =
    draft.operation.mode === "replace"
      ? draft.operation.assignmentId
      : draft.studentId;

  if (part === "schedule") {
    return (
      <>
        {draft.operation.mode === "replace" ? (
          <AssignmentAvailabilityFields
            availability={draft.availability}
            error={fieldErrors.availability}
            id={`${fieldIdPrefix}-availability`}
            memoryKey={scheduleMemoryKey}
            onChange={actions.changeAvailability}
            scheduleRequired={seriesItem}
          />
        ) : null}
        <ExamTimingFields
          error={fieldErrors.timing}
          exam={draft.exam}
          onEnabledChange={actions.changeTimeLimitEnabled}
          onModeChange={actions.changeTimingMode}
          onTimingChange={actions.changeTiming}
        />
        <AssignmentDeadlineFields
          deadline={draft.deadline}
          error={fieldErrors.deadline}
          id={`${fieldIdPrefix}-deadline`}
          memoryKey={scheduleMemoryKey}
          onChange={actions.changeDeadline}
          scheduleRequired={seriesItem}
        />
      </>
    );
  }

  return (
    <>
      <AssignmentWordCountField
        allSelected={draft.questionCount.mode === "automatic"}
        disabled={fieldPolicy.questionCount !== "editable"}
        error={fieldErrors.questionCount}
        errorId={`${fieldIdPrefix}-question-count-error`}
        helpText="전체는 선택한 범위의 단어를 모두 배정하고, 숫자를 누르면 이 시험에 배정할 단어 수를 입력합니다."
        inputLabel="단어 수"
        max={capacity?.maximumQuestionCount ?? 500}
        min={capacity?.minimumQuestionCount ?? minimumQuestionCount}
        onChange={actions.changeQuestionCount}
        onSelectAll={actions.restoreAutomaticCount}
        value={draft.questionCount.value}
      />
      <ExamQuestionOrderField
        error={fieldErrors.questionOrder}
        onChange={(value) =>
          actions.changeOrder(value === "random" ? "random" : "ascending")
        }
        value={draft.exam.questionOrderMode === "random"
          ? "random"
          : "sequential"}
      />
      <ExamConditionFields
        directionDisabled={fieldPolicy.direction !== "editable"}
        exam={draft.exam}
        fieldErrors={fieldErrors}
        idPrefix={fieldIdPrefix}
        onDirectionChange={actions.changeDirection}
        onPassingScoreChange={actions.changePassingScore}
        onRetryEnabledChange={actions.changeRetryEnabled}
        onRetryPassingScoreChange={actions.changeRetryPassingScore}
      />
    </>
  );
}
