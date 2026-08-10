import {
  AssignmentFieldGrid,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";

export function BulkSeriesFields({
  controller,
  fieldIdPrefix,
}: {
  controller: BulkAssignmentController;
  fieldIdPrefix: string;
}) {
  const { actions, state } = controller;
  const { draft } = state;
  const deadlineId = `${fieldIdPrefix}-deadline`;
  const rangeLabelId = `${fieldIdPrefix}-range-mode-label`;

  return (
    <AssignmentFieldGrid columns={3}>
      <Field>
        <FieldLabel
          as="span"
          className={inlineHelpClassName}
          id={rangeLabelId}
        >
          <span>{adminLearningText.bulkAssignmentModal.rangeMode.label}</span>
          <HelpTip
            label={adminLearningText.bulkAssignmentModal.rangeMode.helpAria}
          >
            {adminLearningText.bulkAssignmentModal.rangeMode.help}
          </HelpTip>
        </FieldLabel>
        <Select
          aria-labelledby={rangeLabelId}
          onChange={(event) =>
            actions.changeRange({
              ...draft.range,
              mode: event.target.value as "previous_span" | "fixed_span",
            })
          }
          value={draft.range.mode}
        >
          <option value="previous_span">
            {adminLearningText.bulkAssignmentModal.rangeMode.previousSpan}
          </option>
          <option value="fixed_span">
            {adminLearningText.bulkAssignmentModal.rangeMode.fixedSpan}
          </option>
        </Select>
      </Field>
      {draft.range.mode === "fixed_span" ? (
        <Field as="label">
          <FieldLabel as="span">
            {adminLearningText.bulkAssignmentModal.unitsPerSession}
          </FieldLabel>
          <Input
            max={30}
            min={1}
            onChange={(event) =>
              actions.changeRange({
                ...draft.range,
                unitsPerSession: Number(event.target.value),
              })
            }
            required
            type="number"
            value={draft.range.unitsPerSession}
          />
        </Field>
      ) : null}
      <Field as="label">
        <FieldLabel as="span">
          {adminLearningText.bulkAssignmentModal.sessionCount}
        </FieldLabel>
        <Input
          max={7}
          min={1}
          onChange={(event) =>
            actions.changeRange({
              ...draft.range,
              sessionCount: Number(event.target.value),
            })
          }
          required
          type="number"
          value={draft.range.sessionCount}
        />
      </Field>
      <Field as="label">
        <FieldLabel as="span">
          {adminLearningText.bulkAssignmentModal.firstAvailableDate}
        </FieldLabel>
        <Input
          onChange={(event) =>
            actions.changeFirstAvailableDate(event.target.value)
          }
          required
          type="date"
          value={draft.firstAvailableDateKorean}
        />
      </Field>
      <Field as="label">
        <FieldLabel as="span">
          {adminLearningText.bulkAssignmentModal.dayInterval}
        </FieldLabel>
        <Input
          max={30}
          min={1}
          onChange={(event) =>
            actions.changeInterval(Number(event.target.value))
          }
          required
          type="number"
          value={draft.dayInterval}
        />
      </Field>
      <Field>
        <FieldLabel as="span" className={inlineHelpClassName}>
          <label htmlFor={deadlineId}>
            {adminLearningText.bulkAssignmentModal.firstDeadline}
          </label>
          <HelpTip label={adminLearningText.controls.deadlineHelpAria}>
            {adminLearningText.bulkAssignmentModal.deadlineHelp}
          </HelpTip>
        </FieldLabel>
        <Input
          id={deadlineId}
          onChange={(event) =>
            actions.changeDeadline(
              event.target.value
                ? {
                    mode: "at",
                    koreanLocalDateTime: event.target.value,
                  }
                : { mode: "none" },
            )
          }
          step={60}
          type="datetime-local"
          value={
            draft.firstDeadline.mode === "at"
              ? draft.firstDeadline.koreanLocalDateTime
              : ""
          }
        />
      </Field>
    </AssignmentFieldGrid>
  );
}
