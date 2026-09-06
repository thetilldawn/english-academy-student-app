import { adminLearningText } from "@/content/ko/admin-learning";
import { Field, FieldLabel } from "@/design-system/primitives/form/field";
import { Tabs } from "@/design-system/primitives/tabs/tabs";

import type { AssignmentDirectionRatio, AssignmentQuestionMode } from "../domain/model";
import type { AssignmentQuestionModeView } from "../presentation/assignment-question-mode-view";
import { ExamConditionFields, ExamQuestionOrderField, type ExamConditionValues, type ExamConditionErrors } from "./exam-condition-fields";
import styles from "./vocab-assignment-planner.module.css";

export type BulkExamFieldsProps = {
  questionMode: AssignmentQuestionModeView;
  questionOrder: "sequential" | "random";
  exam: ExamConditionValues;
  directionDisabled: boolean;
  fieldErrors?: ExamConditionErrors & { questionOrder?: string };
  onQuestionModeChange: (value: AssignmentQuestionMode) => void;
  onQuestionOrderChange: (value: "sequential" | "random") => void;
  onDirectionChange: (value: AssignmentDirectionRatio) => void;
  onPassingScoreChange: (value: number) => void;
  onRetryEnabledChange: (value: boolean) => void;
  onRetryPassingScoreChange: (value: number) => void;
};

export function BulkExamFields({
  questionMode, questionOrder, exam, directionDisabled, fieldErrors = {},
  onQuestionModeChange, onQuestionOrderChange, onDirectionChange,
  onPassingScoreChange, onRetryEnabledChange, onRetryPassingScoreChange,
}: BulkExamFieldsProps) {
  return (
    <div className={styles.fieldStack}>
      <Field>
        <FieldLabel as="span" id="bulk-question-mode-label">
          {adminLearningText.questionMode.label}
        </FieldLabel>
        <Tabs
          ariaLabel={adminLearningText.questionMode.label}
          className={styles.modeButtons}
          items={questionMode.tabs}
          onChange={onQuestionModeChange}
          value={questionMode.value}
        />
        {questionMode.notices.map((notice, index) => (
          <small id={notice.id} key={notice.id ?? index} role={notice.role}>
            {notice.message}
          </small>
        ))}
      </Field>
      <ExamQuestionOrderField
        error={fieldErrors.questionOrder}
        onChange={onQuestionOrderChange}
        value={questionOrder}
      />
      <ExamConditionFields
        directionDisabled={directionDisabled}
        exam={exam}
        fieldErrors={{ direction: fieldErrors.direction, passingScore: fieldErrors.passingScore,
          retryPassingScore: fieldErrors.retryPassingScore }}
        idPrefix="bulk"
        onDirectionChange={onDirectionChange}
        onPassingScoreChange={onPassingScoreChange}
        onRetryEnabledChange={onRetryEnabledChange}
        onRetryPassingScoreChange={onRetryPassingScoreChange}
      />
    </div>
  );
}
