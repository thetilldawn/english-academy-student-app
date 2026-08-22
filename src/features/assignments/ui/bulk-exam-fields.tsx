import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import type {
  AssignmentDirectionRatio,
  AssignmentQuestionOrderMode,
  ExamSettings,
} from "../domain/model";
import type { VocabAssignmentFieldKey } from "../presentation/vocab-assignment-field-errors";

type ExamConditionErrors = Partial<
  Record<"direction" | "questionOrder" | "passingScore", string>
>;

export function ExamConditionFields({
  exam,
  fieldErrors = {},
  idPrefix = "exam",
  onDirectionChange,
  onOrderChange,
  onPassingScoreChange,
  orderLabel,
}: {
  exam: ExamSettings;
  fieldErrors?: ExamConditionErrors;
  idPrefix?: string;
  onDirectionChange: (value: AssignmentDirectionRatio) => void;
  onOrderChange: (value: AssignmentQuestionOrderMode) => void;
  onPassingScoreChange: (value: number) => void;
  orderLabel?: string;
}) {
  const directionErrorId = `${idPrefix}-direction-error`;
  const orderErrorId = `${idPrefix}-question-order-error`;
  const scoreErrorId = `${idPrefix}-passing-score-error`;

  return (
    <AssignmentFieldGrid columns={3}>
      <Field as="label">
        <FieldLabel as="span">
          {adminLearningText.controls.direction.label}
        </FieldLabel>
        <Select
          aria-errormessage={fieldErrors.direction
            ? directionErrorId
            : undefined}
          aria-invalid={Boolean(fieldErrors.direction)}
          data-field-key="direction"
          onChange={(event) =>
            onDirectionChange(
              Number(event.target.value) as AssignmentDirectionRatio,
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
          <FieldError id={directionErrorId}>{fieldErrors.direction}</FieldError>
        ) : null}
      </Field>
      <Field as="label">
        <FieldLabel as="span">
          {orderLabel ?? adminLearningText.controls.order.label}
        </FieldLabel>
        <Select
          aria-errormessage={fieldErrors.questionOrder
            ? orderErrorId
            : undefined}
          aria-invalid={Boolean(fieldErrors.questionOrder)}
          data-field-key="questionOrder"
          onChange={(event) =>
            onOrderChange(event.target.value as AssignmentQuestionOrderMode)
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
          <FieldError id={orderErrorId}>{fieldErrors.questionOrder}</FieldError>
        ) : null}
      </Field>
      <Field as="label">
        <FieldLabel as="span">
          {adminLearningText.controls.passingScore}
        </FieldLabel>
        <Input
          aria-errormessage={fieldErrors.passingScore
            ? scoreErrorId
            : undefined}
          aria-invalid={Boolean(fieldErrors.passingScore)}
          data-field-key="passingScore"
          max={100}
          min={0}
          onChange={(event) => onPassingScoreChange(Number(event.target.value))}
          required
          type="number"
          value={exam.passingScore}
        />
        {fieldErrors.passingScore ? (
          <FieldError id={scoreErrorId}>{fieldErrors.passingScore}</FieldError>
        ) : null}
      </Field>
    </AssignmentFieldGrid>
  );
}

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
    <ExamConditionFields
      exam={exam}
      fieldErrors={fieldErrors}
      idPrefix="bulk"
      onDirectionChange={actions.changeDirection}
      onOrderChange={actions.changeOrder}
      onPassingScoreChange={actions.changePassingScore}
      orderLabel={orderLabel}
    />
  );
}
