import { adminLearningText } from "@/content/ko/admin-learning";
import { Button } from "@/design-system/primitives/button/button";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import type { ReviewLevel } from "../domain/model";
import styles from "./bulk-assignment-editor.module.css";

export function BulkReviewFields({
  controller,
}: {
  controller: BulkAssignmentController;
}) {
  const { review } = controller.state.draft;
  if (review.mode !== "pending") return null;

  function toggle(level: ReviewLevel) {
    const levels = review.levels.includes(level)
      ? review.levels.length === 1
        ? review.levels
        : review.levels.filter((candidate) => candidate !== level)
      : [...review.levels, level].toSorted();
    controller.actions.changeReviewLevels(levels);
  }

  return (
    <fieldset className={styles.reviewFieldset}>
      <legend>{adminLearningText.bulkAssignmentModal.wrongWordsLegend}</legend>
      <div className={styles.reviewChoices}>
        <Button
          aria-pressed={review.levels.includes(1)}
          onClick={() => toggle(1)}
          size="small"
          type="button"
          variant="filter"
        >
          {adminLearningText.bulkAssignmentModal.wrongOnce}
        </Button>
        <Button
          aria-pressed={review.levels.includes(2)}
          onClick={() => toggle(2)}
          size="small"
          type="button"
          variant="filter"
        >
          {adminLearningText.bulkAssignmentModal.wrongRepeated}
        </Button>
      </div>
    </fieldset>
  );
}
