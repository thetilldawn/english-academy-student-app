import { Button } from "@/design-system/primitives/button/button";
import { Checkbox } from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { AssignmentSegmentedField } from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";

import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import styles from "./single-assignment-editor.module.css";

export function AssignmentReviewFields({
  availableLevel1,
  availableLevel2,
  controller,
}: {
  availableLevel1: number;
  availableLevel2: number;
  controller: SingleAssignmentController;
}) {
  const { actions, capacity, isExactReview, state } = controller;
  const review = state.draft.review;
  const replacing = state.draft.operation.mode === "replace";
  const level1 = capacity?.wrongLevel1Eligible ?? availableLevel1;
  const level2 = capacity?.wrongLevel2Eligible ?? availableLevel2;

  return (
    <fieldset
      aria-label={adminLearningText.assignmentModal.wrongWords.title}
      className={styles.reviewOptions}
    >
      <div className={styles.reviewToggleRow}>
        <label className={styles.reviewSwitch}>
          <Checkbox
            aria-label={adminLearningText.assignmentModal.wrongWords.title}
            checked={review.mode === "pending"}
            disabled={isExactReview}
            onChange={(event) =>
              actions.changeReviewMode(
                event.target.checked ? "pending" : "none",
              )
            }
          />
        </label>
        <HelpTip
          label={adminLearningText.assignmentModal.wrongWords.helpAria}
          trigger={adminLearningText.assignmentModal.wrongWords.title}
        >
          {adminLearningText.assignmentModal.wrongWords.help}
        </HelpTip>
      </div>
      <div aria-live="polite" className={styles.reviewCounts}>
        <span>
          {formatContentText(
            adminLearningText.assignmentModal.wrongWords.countSummary,
            {
              count: level1 + level2,
              label: adminLearningText.assignmentModal.wrongWords.total,
            },
          )}
        </span>
        <span>
          {formatContentText(
            adminLearningText.assignmentModal.wrongWords.countSummary,
            {
              count: level1,
              label: adminLearningText.assignmentModal.wrongWords.once,
            },
          )}
        </span>
        <span>
          {formatContentText(
            adminLearningText.assignmentModal.wrongWords.countSummary,
            {
              count: level2,
              label: adminLearningText.assignmentModal.wrongWords.repeated,
            },
          )}
        </span>
      </div>
      {review.mode === "pending" ? (
        <div className={styles.reviewControls}>
          <AssignmentSegmentedField
            helpAriaLabel={
              adminLearningText.assignmentModal.wrongWords.scopeHelpAria
            }
            helpText={adminLearningText.assignmentModal.wrongWords.scopeHelp}
            label={adminLearningText.assignmentModal.wrongWords.scopeLabel}
            onChange={actions.changeReviewScope}
            options={[
              {
                disabled: replacing,
                label: adminLearningText.assignmentModal.wrongWords.scopeAll,
                value: "dataset",
              },
              {
                disabled: replacing,
                label:
                  adminLearningText.assignmentModal.wrongWords.scopeCurrent,
                value: "selection",
              },
            ]}
            value={review.scope}
          />
          <div
            aria-label={
              adminLearningText.assignmentModal.wrongWords.levelGroupAria
            }
            className={styles.reviewLevelButtons}
            role="group"
          >
            <Button
              aria-pressed={review.levels.includes(1)}
              disabled={isExactReview}
              onClick={() => actions.toggleReviewLevel(1)}
              size="small"
              variant="filter"
            >
              {adminLearningText.assignmentModal.wrongWords.once}
            </Button>
            <Button
              aria-pressed={review.levels.includes(2)}
              disabled={isExactReview}
              onClick={() => actions.toggleReviewLevel(2)}
              size="small"
              variant="filter"
            >
              {adminLearningText.assignmentModal.wrongWords.repeated}
            </Button>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
