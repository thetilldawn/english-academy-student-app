import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { koreanDateTimeLocalToIso } from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

import type { AssignmentDatasetItem, AssignmentUnitItem } from "../catalog-types";
import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import type { SingleAssignmentDraft } from "../domain/model";
import { assignmentRequestFingerprint } from "../domain/fingerprint";
import { assignmentUnitRangeLabel } from "../presentation/assignment-unit-range-label";
import styles from "./single-assignment-editor.module.css";

type ChangeKey =
  | "title"
  | "dataset"
  | "range"
  | "questionCount"
  | "direction"
  | "order"
  | "timing"
  | "passingScore"
  | "deadline"
  | "review";

const labels: Record<ChangeKey, string> = {
  dataset: adminLearningText.assignmentModal.range.wordbook,
  deadline: adminLearningText.assignmentModal.deadline.label,
  direction: adminLearningText.controls.direction.label,
  order: adminLearningText.controls.order.label,
  passingScore: adminLearningText.controls.passingScore,
  questionCount: adminLearningText.assignmentModal.conditions.questionCount,
  range: adminLearningText.assignmentModal.range.groupFallback,
  review: adminLearningText.assignmentModal.wrongWords.title,
  timing: adminLearningText.controls.timing.label,
  title: adminLearningText.assignmentModal.submit.optionalTitle,
};

function comparable(draft: SingleAssignmentDraft, key: ChangeKey) {
  if (key === "title") return draft.title;
  if (key === "dataset") return draft.range.datasetId;
  if (key === "range") return draft.range.orderedUnitIds;
  if (key === "questionCount") return draft.questionCount.value;
  if (key === "direction") return draft.exam.directionRatio;
  if (key === "order") return draft.exam.questionOrderMode;
  if (key === "timing") return draft.exam.timing;
  if (key === "passingScore") return draft.exam.passingScore;
  if (key === "deadline") return draft.deadline;
  return draft.review;
}

function valueLabel(
  draft: SingleAssignmentDraft,
  key: ChangeKey,
  datasets: readonly AssignmentDatasetItem[],
  units: readonly AssignmentUnitItem[],
) {
  if (key === "title") {
    return draft.title.mode === "automatic"
      ? adminLearningText.assignmentModal.submit.autoTitle
      : draft.title.value;
  }
  if (key === "dataset") {
    const dataset = datasets.find(
      (candidate) => candidate.id === draft.range.datasetId,
    );
    return dataset
      ? cataloguedDatasetDisplayLabel(dataset)
      : adminLearningText.assignmentModal.range.unavailableWordbook;
  }
  if (key === "range") {
    return assignmentUnitRangeLabel(
      draft.range.orderedUnitIds.map(
        (unitId) =>
          units.find((unit) => unit.id === unitId)?.displayName ??
          adminLearningText.assignmentModal.range.unknownUnit,
      ),
    );
  }
  if (key === "questionCount") return String(draft.questionCount.value);
  if (key === "direction") {
    return draft.exam.directionRatio === 100
      ? adminLearningText.controls.direction.englishToMeaning
      : draft.exam.directionRatio === 0
        ? adminLearningText.controls.direction.meaningToEnglish
        : adminLearningText.controls.direction.mixed;
  }
  if (key === "order") {
    return adminLearningText.controls.order[draft.exam.questionOrderMode];
  }
  if (key === "timing") {
    return draft.exam.timing.mode === "total"
      ? formatContentText(adminLearningText.assignmentModal.edit.totalTiming, {
          minutes: draft.exam.timing.totalSeconds / 60,
        })
      : formatContentText(
          adminLearningText.assignmentModal.edit.perQuestionTiming,
          { seconds: draft.exam.timing.perQuestionSeconds },
        );
  }
  if (key === "passingScore") return `${draft.exam.passingScore}`;
  if (key === "deadline") {
    if (draft.deadline.mode === "none") {
      return adminLearningText.assignmentModal.edit.noDeadline;
    }
    const deadlineIso = koreanDateTimeLocalToIso(
      draft.deadline.koreanLocalDateTime,
    );
    return deadlineIso
      ? formatKoreanDateTime(deadlineIso)
      : draft.deadline.koreanLocalDateTime;
  }
  if (draft.review.mode === "none") {
    return adminLearningText.assignmentModal.edit.noWrongWords;
  }
  return draft.review.levels
    .map((level) =>
      level === 1
        ? adminLearningText.bulkAssignmentModal.wrongOnce
        : adminLearningText.bulkAssignmentModal.wrongRepeated,
    )
    .join(" · ");
}

export function AssignmentEditComparison({
  controller,
  datasets,
  units,
}: {
  controller: SingleAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  units: readonly AssignmentUnitItem[];
}) {
  const baseline = controller.baselineDraft;
  if (!baseline) return null;
  const keys = (
    [
      "title",
      "dataset",
      "range",
      "questionCount",
      "direction",
      "order",
      "timing",
      "passingScore",
      "deadline",
      "review",
    ] as const
  ).filter(
    (key) =>
      assignmentRequestFingerprint(comparable(baseline, key)) !==
      assignmentRequestFingerprint(comparable(controller.state.draft, key)),
  );
  const rebuildsQuestions = keys.some((key) =>
    ["dataset", "range", "questionCount", "direction", "review"].includes(
      key,
    ),
  );
  return (
    <section
      aria-label={adminLearningText.assignmentModal.edit.comparisonAria}
      className={styles.editComparison}
    >
      <div className={styles.editComparisonHeading}>
        <strong className={inlineHelpClassName}>
          {adminLearningText.assignmentModal.edit.comparisonTitle}
          {rebuildsQuestions ? (
            <HelpTip
              label={adminLearningText.assignmentModal.edit.rebuildHelpAria}
              trigger="문항 재생성"
            >
              {adminLearningText.assignmentModal.edit.rebuildQuestionsHelp}
            </HelpTip>
          ) : null}
        </strong>
        <span>
          {formatContentText(
            adminLearningText.assignmentModal.edit.changedCount,
            { count: keys.length },
          )}
        </span>
      </div>
      {keys.length > 0 ? (
        <dl>
          {keys.map((key) => (
            <div key={key}>
              <dt>{labels[key]}</dt>
              <dd>
                <span>
                  <span className="sr-only">
                    {adminLearningText.assignmentModal.edit.before}
                  </span>
                  {valueLabel(baseline, key, datasets, units)}
                </span>
                <span aria-hidden="true">→</span>
                <strong>
                  <span className="sr-only">
                    {adminLearningText.assignmentModal.edit.after}
                  </span>
                  {valueLabel(controller.state.draft, key, datasets, units)}
                </strong>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>{adminLearningText.assignmentModal.edit.unchanged}</p>
      )}
    </section>
  );
}
