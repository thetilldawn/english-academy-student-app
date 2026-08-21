import {
  AssignmentFieldGrid,
  AssignmentTimingModeField,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";

export function BulkExamFields({
  controller,
  fieldErrors = {},
  orderLabel,
}: {
  controller: BulkAssignmentController;
  fieldErrors?: Partial<Record<VocabAssignmentFieldKey, string>>;
  orderLabel?: string;
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
            aria-errormessage={fieldErrors.direction
              ? "bulk-direction-error"
              : undefined}
            aria-invalid={Boolean(fieldErrors.direction)}
            data-field-key="direction"
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
          {fieldErrors.direction ? (
            <FieldError id="bulk-direction-error">
              {fieldErrors.direction}
            </FieldError>
          ) : null}
        </Field>
        <Field as="label">
          <FieldLabel as="span">
            {orderLabel ?? adminLearningText.controls.order.label}
          </FieldLabel>
          <Select
            aria-errormessage={fieldErrors.questionOrder
              ? "bulk-question-order-error"
              : undefined}
            aria-invalid={Boolean(fieldErrors.questionOrder)}
            data-field-key="questionOrder"
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
          {fieldErrors.questionOrder ? (
            <FieldError id="bulk-question-order-error">
              {fieldErrors.questionOrder}
            </FieldError>
          ) : null}
        </Field>
        <Field as="label">
          <FieldLabel as="span">
            {adminLearningText.controls.passingScore}
          </FieldLabel>
          <Input
            aria-errormessage={fieldErrors.passingScore
              ? "bulk-passing-score-error"
              : undefined}
            aria-invalid={Boolean(fieldErrors.passingScore)}
            data-field-key="passingScore"
            max={100}
            min={0}
            onChange={(event) =>
              actions.changePassingScore(Number(event.target.value))
            }
            required
            type="number"
            value={exam.passingScore}
          />
          {fieldErrors.passingScore ? (
            <FieldError id="bulk-passing-score-error">
              {fieldErrors.passingScore}
            </FieldError>
          ) : null}
        </Field>
      </AssignmentFieldGrid>
      <AssignmentFieldGrid>
        <div data-field-key="timing" tabIndex={-1}>
          <AssignmentTimingModeField
            helpAriaLabel={adminLearningText.controls.timing.helpAria}
            helpText={adminLearningText.assignmentModal.conditions.timingHelp}
            label={adminLearningText.assignmentModal.conditions.timingMode}
            mode={exam.timing.mode}
            onChange={actions.changeTimingMode}
            perQuestionLabel={adminLearningText.controls.timing.perQuestion}
            totalLabel={adminLearningText.controls.timing.total}
          />
        </div>
        <Field as="label">
          <FieldLabel as="span">
            {exam.timing.mode === "total"
              ? adminLearningText.controls.timing.totalMinutes
              : adminLearningText.controls.timing.perQuestionSeconds}
          </FieldLabel>
          {exam.timing.mode === "total" ? (
            <Input
              aria-errormessage={fieldErrors.timing
                ? "bulk-timing-error"
                : undefined}
              aria-invalid={Boolean(fieldErrors.timing)}
              data-field-key="timing"
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
              aria-errormessage={fieldErrors.timing
                ? "bulk-timing-error"
                : undefined}
              aria-invalid={Boolean(fieldErrors.timing)}
              data-field-key="timing"
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
          {fieldErrors.timing ? (
            <FieldError id="bulk-timing-error">
              {fieldErrors.timing}
            </FieldError>
          ) : null}
        </Field>
      </AssignmentFieldGrid>
    </>
  );
}
