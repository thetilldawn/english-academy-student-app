import { Button } from "@/design-system/primitives/button/button";
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
import {
  AssignmentFieldGrid,
  AssignmentTimingModeField,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";

import type { SingleAssignmentController } from "../controller/use-assignment-controller";

export function AssignmentSettingsFields({
  controller,
  fieldIdPrefix,
}: {
  controller: SingleAssignmentController;
  fieldIdPrefix: string;
}) {
  const { actions, capacity, isExactReview, minimumQuestionCount, state } =
    controller;
  const { draft } = state;
  const questionCountId = `${fieldIdPrefix}-question-count`;
  const deadlineId = `${fieldIdPrefix}-deadline`;
  const titleId = `${fieldIdPrefix}-title`;

  return (
    <>
      <AssignmentFieldGrid>
        <Field as="label">
          <FieldLabel as="span">
            {adminLearningText.assignmentModal.conditions.direction}
          </FieldLabel>
          <Select
            onChange={(event) =>
              actions.changeDirection(
                Number(event.target.value) as 0 | 50 | 100,
              )
            }
            value={draft.exam.directionRatio}
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
            {adminLearningText.assignmentModal.conditions.order}
          </FieldLabel>
          <Select
            onChange={(event) =>
              actions.changeOrder(
                event.target.value as "ascending" | "descending" | "random",
              )
            }
            value={draft.exam.questionOrderMode}
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
      </AssignmentFieldGrid>
      <AssignmentFieldGrid>
        <Field>
          <FieldLabel as="span">
            <label htmlFor={questionCountId}>
              {draft.review.mode === "pending"
                ? adminLearningText.assignmentModal.conditions.totalQuestionCount
                : adminLearningText.assignmentModal.conditions.questionCount}
            </label>
          </FieldLabel>
          <Input
            id={questionCountId}
            max={capacity?.maximumQuestionCount ?? 500}
            min={capacity?.minimumQuestionCount ?? minimumQuestionCount}
            onChange={(event) =>
              actions.changeQuestionCount(Number(event.target.value))
            }
            readOnly={isExactReview}
            required
            type="number"
            value={draft.questionCount.value}
          />
          {draft.questionCount.mode === "manual" &&
          capacity &&
          capacity.recommendedQuestionCount >= minimumQuestionCount &&
          !isExactReview ? (
            <Button
              onClick={actions.restoreAutomaticCount}
              size="small"
              variant="quiet"
            >
              {formatContentText(
                adminLearningText.assignmentModal.conditions.restoreRecommended,
                { count: capacity.recommendedQuestionCount },
              )}
            </Button>
          ) : null}
        </Field>
        <AssignmentTimingModeField
          helpAriaLabel={adminLearningText.controls.timing.helpAria}
          helpText={adminLearningText.assignmentModal.conditions.timingHelp}
          label={adminLearningText.assignmentModal.conditions.timingMode}
          mode={draft.exam.timing.mode}
          onChange={actions.changeTimingMode}
          perQuestionLabel={adminLearningText.controls.timing.perQuestion}
          totalLabel={adminLearningText.controls.timing.total}
        />
      </AssignmentFieldGrid>
      <AssignmentFieldGrid>
        <Field as="label">
          <FieldLabel as="span">
            {draft.exam.timing.mode === "total"
              ? adminLearningText.assignmentModal.conditions.totalTime
              : adminLearningText.assignmentModal.conditions.perQuestionTime}
          </FieldLabel>
          {draft.exam.timing.mode === "total" ? (
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
              value={draft.exam.timing.totalSeconds / 60}
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
              value={draft.exam.timing.perQuestionSeconds}
            />
          )}
        </Field>
        <Field as="label">
          <FieldLabel as="span">
            {adminLearningText.assignmentModal.conditions.passingScore}
          </FieldLabel>
          <Input
            max={100}
            min={0}
            onChange={(event) =>
              actions.changePassingScore(Number(event.target.value))
            }
            required
            type="number"
            value={draft.exam.passingScore}
          />
        </Field>
      </AssignmentFieldGrid>
      <Field>
        <FieldLabel as="span" className={inlineHelpClassName}>
          <HelpTip
            label={adminLearningText.assignmentModal.deadline.helpAria}
            trigger={adminLearningText.assignmentModal.deadline.label}
          >
            {adminLearningText.assignmentModal.deadline.help}
          </HelpTip>
        </FieldLabel>
        <Input
          aria-label={adminLearningText.assignmentModal.deadline.label}
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
            draft.deadline.mode === "at"
              ? draft.deadline.koreanLocalDateTime
              : ""
          }
        />
      </Field>
      <Field>
        <FieldLabel as="span" className={inlineHelpClassName}>
          <HelpTip
            label={adminLearningText.controls.titleHelpAria}
            trigger={adminLearningText.assignmentModal.submit.optionalTitle}
          >
            {adminLearningText.assignmentModal.submit.titleHelp}
          </HelpTip>
        </FieldLabel>
        <Input
          aria-label={adminLearningText.assignmentModal.submit.optionalTitle}
          id={titleId}
          maxLength={160}
          onChange={(event) => actions.changeTitle(event.target.value)}
          placeholder={controller.automaticTitle}
          value={draft.title.mode === "automatic" ? "" : draft.title.value}
        />
      </Field>
    </>
  );
}
