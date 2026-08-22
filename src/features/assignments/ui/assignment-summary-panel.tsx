import { adminLearningText } from "@/content/ko/admin-learning";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { formatContentText } from "@/content/format";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { koreanDateTimeLocalToIso } from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import { AssignmentEditComparison } from "./assignment-edit-comparison";
import { assignmentUnitRangeLabel } from "../presentation/assignment-unit-range-label";
import styles from "./single-assignment-editor.module.css";

export function AssignmentSummaryPanel({
  controller,
  datasets,
  units,
}: {
  controller: SingleAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  units: readonly AssignmentUnitItem[];
}) {
  const { capacity, minimumQuestionCount, state } = controller;
  const { draft, preview } = state;
  const dataset = datasets.find(
    (candidate) => candidate.id === draft.range.datasetId,
  );
  const rangeLabel = assignmentUnitRangeLabel(
    draft.range.orderedUnitIds.map(
      (unitId) =>
        units.find((unit) => unit.id === unitId)?.displayName ??
        adminLearningText.assignmentModal.range.unknownUnit,
    ),
  );
  const deadlineIso =
    draft.deadline.mode === "at"
      ? koreanDateTimeLocalToIso(draft.deadline.koreanLocalDateTime)
      : null;
  const capacityMessage =
    capacity && capacity.maximumQuestionCount < minimumQuestionCount
      ? formatContentText(
          adminLearningText.assignmentModal.errors.rangeUnavailable,
          { count: capacity.maximumQuestionCount },
        )
      : capacity && draft.questionCount.value > capacity.maximumQuestionCount
        ? formatContentText(
            adminLearningText.assignmentModal.errors.maximumDetail,
            { count: capacity.maximumQuestionCount },
          )
        : capacity && draft.questionCount.value < capacity.minimumQuestionCount
          ? formatContentText(
              adminLearningText.assignmentModal.errors.minimumDetail,
              { count: capacity.minimumQuestionCount },
            )
          : draft.review.mode === "pending" &&
              capacity &&
              capacity.wrongEligible === 0
            ? adminLearningText.assignmentModal.wrongWords.noEligible
            : "";
  const previewError = preview.status === "error" ? preview.message : "";

  return (
    <section className={styles.summaryPanel}>
      <h3>{adminLearningText.assignmentModal.summary.title}</h3>
      <dl className={styles.summaryFacts}>
        <div>
          <dt>{adminLearningText.assignmentModal.summary.wordbook}</dt>
          <dd>
            {dataset
              ? cataloguedDatasetDisplayLabel(dataset)
              : adminLearningText.assignmentModal.range.selectWordbook}
          </dd>
        </div>
        <div>
          <dt>{adminLearningText.assignmentModal.summary.range}</dt>
          <dd>{rangeLabel}</dd>
        </div>
        <div>
          <dt>{adminLearningText.assignmentModal.summary.questions}</dt>
          <dd>
            {formatContentText(
              adminLearningText.assignmentModal.edit.questionCount,
              { count: draft.questionCount.value },
            )}
          </dd>
        </div>
        <div>
          <dt>{adminLearningText.assignmentModal.summary.timing}</dt>
          <dd>
            {draft.exam.timeLimitEnabled === false
              ? "시간 제한 없음"
              : draft.exam.timing.mode === "total"
              ? formatContentText(
                  adminLearningText.assignmentModal.edit.totalTiming,
                  { minutes: draft.exam.timing.totalSeconds / 60 },
                )
              : formatContentText(
                  adminLearningText.assignmentModal.edit.perQuestionTiming,
                  { seconds: draft.exam.timing.perQuestionSeconds },
                )}
          </dd>
        </div>
        <div>
          <dt>{adminLearningText.assignmentModal.summary.passingScore}</dt>
          <dd>
            {formatContentText(adminLearningText.assignmentModal.edit.score, {
              score: draft.exam.passingScore,
            })}
          </dd>
        </div>
        <div>
          <dt>{adminLearningText.assignmentModal.summary.deadline}</dt>
          <dd>
            {deadlineIso
              ? formatKoreanDateTime(deadlineIso)
              : adminLearningText.assignmentModal.edit.noDeadline}
          </dd>
        </div>
      </dl>
      <AssignmentEditComparison
        controller={controller}
        datasets={datasets}
        units={units}
      />
      {preview.status === "loading" ? (
        <span className="sr-only" role="status">
          {adminLearningText.assignmentModal.errors.capacityLoading}
        </span>
      ) : null}
      {[
        previewError,
        capacityMessage,
        ...controller.issues.map((issue) => issue.message),
      ]
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .map((value) => (
          <Notice key={value} role="alert" tone="danger">
            {value}
          </Notice>
        ))}
    </section>
  );
}
