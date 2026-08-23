import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Input,
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
import {
  ExamConditionFields,
  ExamQuestionOrderField,
} from "./bulk-exam-fields";

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
      <ExamQuestionOrderField
        onChange={(value) =>
          actions.changeOrder(value === "random" ? "random" : "ascending")
        }
        value={draft.exam.questionOrderMode === "random"
          ? "random"
          : "source_order"}
      />
      <ExamConditionFields
        exam={draft.exam}
        idPrefix={fieldIdPrefix}
        onDirectionChange={actions.changeDirection}
        onPassingScoreChange={actions.changePassingScore}
        onRetryEnabledChange={actions.changeRetryEnabled}
        onRetryPassingScoreChange={actions.changeRetryPassingScore}
      />
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
