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
import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";

import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import { AssignmentDeadlineFields } from "./assignment-deadline-fields";
import { ExamTimingFields } from "./exam-timing-fields";

export function AssignmentSettingsFields({
  controller,
  fieldIdPrefix,
  part,
}: {
  controller: SingleAssignmentController;
  fieldIdPrefix: string;
  part: "conditions" | "schedule";
}) {
  const { actions, capacity, isExactReview, minimumQuestionCount, state } =
    controller;
  const { draft } = state;
  const questionCountId = `${fieldIdPrefix}-question-count`;
  const deadlineId = `${fieldIdPrefix}-deadline`;
  const titleId = `${fieldIdPrefix}-title`;

  if (part === "schedule") {
    return (
      <>
        <ExamTimingFields
          exam={draft.exam}
          onEnabledChange={actions.changeTimeLimitEnabled}
          onModeChange={actions.changeTimingMode}
          onTimingChange={actions.changeTiming}
        />
        <AssignmentDeadlineFields
          deadline={draft.deadline}
          id={deadlineId}
          onChange={actions.changeDeadline}
        />
      </>
    );
  }

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
