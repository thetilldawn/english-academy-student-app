import {
  AssignmentFieldGrid,
  AssignmentTimingModeField,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  Field,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";

export function BulkExamFields({
  controller,
}: {
  controller: BulkAssignmentController;
}) {
  const { actions, state } = controller;
  const { exam } = state.draft;

  return (
    <>
      <AssignmentFieldGrid columns={3}>
        <Field as="label">
          <FieldLabel as="span">
            {adminLearningText.controls.direction.label}
          </FieldLabel>
          <Select
            onChange={(event) =>
              actions.changeDirection(
                Number(event.target.value) as 0 | 50 | 100,
              )
            }
            value={exam.directionRatio}
          >
            <option value={100}>
              {adminLearningText.controls.direction.englishToMeaning}
            </option>
            <option value={0}>
              {adminLearningText.controls.direction.meaningToEnglish}
            </option>
            <option value={50}>
              {adminLearningText.controls.direction.mixed}
            </option>
          </Select>
        </Field>
        <Field as="label">
          <FieldLabel as="span">
            {adminLearningText.controls.order.label}
          </FieldLabel>
          <Select
            onChange={(event) =>
              actions.changeOrder(
                event.target.value as "ascending" | "descending" | "random",
              )
            }
            value={exam.questionOrderMode}
          >
            <option value="ascending">
              {adminLearningText.controls.order.ascending}
            </option>
            <option value="descending">
              {adminLearningText.controls.order.descending}
            </option>
            <option value="random">
              {adminLearningText.controls.order.random}
            </option>
          </Select>
        </Field>
        <Field as="label">
          <FieldLabel as="span">
            {adminLearningText.controls.passingScore}
          </FieldLabel>
          <Input
            max={100}
            min={0}
            onChange={(event) =>
              actions.changePassingScore(Number(event.target.value))
            }
            required
            type="number"
            value={exam.passingScore}
          />
        </Field>
      </AssignmentFieldGrid>
      <AssignmentFieldGrid>
        <AssignmentTimingModeField
          helpAriaLabel={adminLearningText.controls.timing.helpAria}
          helpText={adminLearningText.assignmentModal.conditions.timingHelp}
          label={adminLearningText.assignmentModal.conditions.timingMode}
          mode={exam.timing.mode}
          onChange={actions.changeTimingMode}
          perQuestionLabel={adminLearningText.controls.timing.perQuestion}
          totalLabel={adminLearningText.controls.timing.total}
        />
        <Field as="label">
          <FieldLabel as="span">
            {exam.timing.mode === "total"
              ? adminLearningText.controls.timing.totalMinutes
              : adminLearningText.controls.timing.perQuestionSeconds}
          </FieldLabel>
          {exam.timing.mode === "total" ? (
            <Input
              max={180}
              min={0.5}
              onChange={(event) =>
                actions.changeTiming({
                  mode: "total",
                  totalSeconds: Number(event.target.value) * 60,
                })
              }
              required
              step={0.5}
              type="number"
              value={exam.timing.totalSeconds / 60}
            />
          ) : (
            <Input
              max={600}
              min={5}
              onChange={(event) =>
                actions.changeTiming({
                  mode: "per_question",
                  perQuestionSeconds: Number(event.target.value),
                })
              }
              required
              type="number"
              value={exam.timing.perQuestionSeconds}
            />
          )}
        </Field>
      </AssignmentFieldGrid>
    </>
  );
}
