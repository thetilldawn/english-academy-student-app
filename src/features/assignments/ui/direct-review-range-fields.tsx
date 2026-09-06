import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldError, FieldLabel } from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import type { ReviewLevel } from "../domain/model";
import type { DirectReviewRangeView } from "../presentation/direct-review-view";
import { AssignmentDatasetTrigger, type AssignmentDatasetTriggerProps } from "./assignment-dataset-trigger";
import styles from "./vocab-assignment-planner.module.css";

export type DirectReviewRangeFieldsProps = {
  dataset?: AssignmentDatasetTriggerProps["dataset"];
  datasetTriggerRef?: AssignmentDatasetTriggerProps["triggerRef"];
  view: DirectReviewRangeView;
  fieldErrors: { dataset?: string; reviewLevels?: string; questionCount?: string };
  onOpenDatasetPicker: () => void;
  onToggleReviewLevel: (level: ReviewLevel) => void;
  onRetryCalculation: () => void;
};

export function DirectReviewRangeFields({
  dataset, datasetTriggerRef, view, fieldErrors, onOpenDatasetPicker,
  onToggleReviewLevel, onRetryCalculation,
}: DirectReviewRangeFieldsProps) {
  return <>
    <div className={styles.reviewRangeGrid}>
      <div className={styles.fieldStack}>
        <AssignmentDatasetTrigger dataset={dataset} disabled={view.datasetDisabled}
          error={fieldErrors.dataset} errorId="review-dataset-error"
          onOpen={onOpenDatasetPicker} triggerRef={datasetTriggerRef} />
        <span className={styles.rangeSummary}>{view.totalLabel}</span>
      </div>
      <Field>
        <FieldLabel as="span" id="review-level-label">
          <HelpTip label="틀린 횟수 설명" trigger="틀린 횟수">단어 시험에서 틀린 횟수입니다.</HelpTip>
        </FieldLabel>
        <div aria-labelledby="review-level-label" className={styles.reviewLevelButtons}
          data-field-key="reviewLevels" role="group" tabIndex={-1}>
          {view.levels.map((level) => <Button aria-pressed={level.selected}
            disabled={level.disabled} key={level.value} onClick={() => onToggleReviewLevel(level.value)}
            size="small" variant="filter">{level.label}</Button>)}
        </div>
        {fieldErrors.reviewLevels ? <FieldError>{fieldErrors.reviewLevels}</FieldError> : null}
      </Field>
    </div>
    <div className={styles.fieldStack} data-field-key="preview" tabIndex={-1}>
      {view.calculation.error ? <>
        <Notice role="alert" tone="danger">{view.calculation.error}</Notice>
        <div className={styles.warningActions}>
          <Button onClick={onRetryCalculation} size="small" variant="secondary">{view.calculation.retryLabel}</Button>
        </div>
      </> : <div aria-live="polite" className={styles.reviewCalculation} data-field-key="questionCount"
        data-status={view.calculation.status} role="status" tabIndex={-1}>{view.calculation.countText}</div>}
      {fieldErrors.questionCount ? <FieldError>{fieldErrors.questionCount}</FieldError> : null}
    </div>
  </>;
}
