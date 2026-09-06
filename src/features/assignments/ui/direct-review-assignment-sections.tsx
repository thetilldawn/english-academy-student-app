import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";

import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
} from "../catalog-types";
import type {
  DirectReviewAssignmentController,
  DirectReviewFieldKey,
} from "../controller/use-direct-review-assignment-controller";
import { AssignmentAvailabilityFields } from "./assignment-availability-fields";
import { AssignmentDeadlineFields } from "./assignment-deadline-fields";
import { AssignmentSection } from "./assignment-section";
import type { AssignmentDatasetTriggerProps } from "./assignment-dataset-trigger";
import { directReviewRangeView, directReviewPreviewRows } from "../presentation/direct-review-view";
import { DirectReviewRangeFields } from "./direct-review-range-fields";
import { DirectReviewPreview } from "./direct-review-preview";
import {
  ExamConditionFields,
  ExamQuestionOrderField,
} from "./exam-condition-fields";
import { ExamTimingFields } from "./exam-timing-fields";
import styles from "./vocab-assignment-planner.module.css";

export function DirectReviewAssignmentSections({
  controller,
  datasets,
  fieldErrors,
  onOpenDatasetPicker,
  datasetTriggerRef,
  student,
}: {
  controller: DirectReviewAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  fieldErrors: Partial<Record<DirectReviewFieldKey, string>>;
  onOpenDatasetPicker: () => void;
  datasetTriggerRef?: AssignmentDatasetTriggerProps["triggerRef"];
  student: AssignmentStudentItem;
}) {
  const { capacity, draft, knownLevelCounts, summary } = controller;
  const dataset = datasets.find((candidate) => candidate.id === draft.datasetId);
  const rangeStatus = fieldErrors.dataset || fieldErrors.reviewLevels ||
    fieldErrors.questionCount || fieldErrors.preview
    ? "범위 확인"
    : null;
  const conditionStatus = fieldErrors.direction || fieldErrors.questionOrder ||
    fieldErrors.passingScore || fieldErrors.retryPassingScore
    ? "조건 확인"
    : null;
  const scheduleStatus = fieldErrors.availability || fieldErrors.timing ||
      fieldErrors.deadline
    ? "일정 확인"
    : null;
  const rangeView = directReviewRangeView({
    summary: { status: summary.status, message: summary.message },
    capacity: { status: capacity.status, message: capacity.message },
    hasDatasetOptions: controller.datasetOptions.length > 0,
    totalAvailableCount: controller.totalAvailableCount,
    questionCount: draft.questionCount, knownLevelCounts,
    selectedLevels: draft.reviewLevels,
  });
  const previewRows = directReviewPreviewRows({
    studentLabel: student.displayName,
    datasetLabel: dataset ? cataloguedDatasetDisplayLabel(dataset) : "선택 전",
    selectedLevels: draft.reviewLevels, questionCount: draft.questionCount,
    availability: draft.availability, deadline: draft.deadline,
    timeLimitEnabled: draft.exam.timeLimitEnabled, timing: draft.exam.timing,
  });

  return (
    <div className={styles.plannerSections}>
      <AssignmentSection
        help="학생의 미배정 오답을 단어장별로 다시 계산합니다."
        helpLabel="오답 시험 범위 설명"
        index={1}
        status={rangeStatus}
        title="시험 범위"
      >
        <DirectReviewRangeFields dataset={dataset} datasetTriggerRef={datasetTriggerRef}
          view={rangeView} fieldErrors={{ dataset: fieldErrors.dataset,
            reviewLevels: fieldErrors.reviewLevels, questionCount: fieldErrors.questionCount }}
          onOpenDatasetPicker={onOpenDatasetPicker}
          onToggleReviewLevel={controller.actions.toggleReviewLevel}
          onRetryCalculation={summary.status === "error" ? controller.actions.retrySummary : controller.actions.retryPreview} />
      </AssignmentSection>

      <AssignmentSection
        help="오답 단어의 문제 순서와 통과 기준을 정합니다."
        helpLabel="오답 시험 조건 설명"
        index={2}
        status={conditionStatus}
        title="시험 조건"
      >
        <div className={styles.reviewQuestionCount}>
          <span>단어 수</span>
          <strong>{draft.questionCount}개</strong>
        </div>
        <ExamQuestionOrderField
          error={fieldErrors.questionOrder}
          onChange={(value) =>
            controller.actions.changeOrder(
              value === "random" ? "random" : "ascending",
            )
          }
          value={draft.exam.questionOrderMode === "random"
            ? "random"
            : "sequential"}
        />
        <ExamConditionFields
          exam={{ directionRatio: draft.exam.directionRatio, passingScore: draft.exam.passingScore,
            retryEnabled: draft.exam.retryEnabled, retryPassingScore: draft.exam.retryPassingScore }}
          fieldErrors={{ direction: fieldErrors.direction, passingScore: fieldErrors.passingScore,
            retryPassingScore: fieldErrors.retryPassingScore }}
          idPrefix="review"
          onDirectionChange={controller.actions.changeDirection}
          onPassingScoreChange={controller.actions.changePassingScore}
          onRetryEnabledChange={controller.actions.changeRetryEnabled}
          onRetryPassingScoreChange={
            controller.actions.changeRetryPassingScore
          }
        />
      </AssignmentSection>

      <AssignmentSection
        help="제한시간과 응시 마감 사용 여부를 각각 정합니다."
        helpLabel="오답 시험 일정 설명"
        index={3}
        status={scheduleStatus}
        title="시험 일정"
      >
        <AssignmentAvailabilityFields
          availability={draft.availability}
          error={fieldErrors.availability}
          id="review-availability"
          memoryKey={student.id}
          onChange={controller.actions.changeAvailability}
        />
        <ExamTimingFields
          error={fieldErrors.timing}
          enabled={draft.exam.timeLimitEnabled !== false}
          timing={draft.exam.timing}
          onEnabledChange={controller.actions.changeTimeLimitEnabled}
          onModeChange={controller.actions.changeTimingMode}
          onTimingChange={controller.actions.changeTiming}
        />
        <AssignmentDeadlineFields
          deadline={draft.deadline}
          error={fieldErrors.deadline}
          id="review-deadline"
          onChange={controller.actions.changeDeadline}
        />
      </AssignmentSection>

      <AssignmentSection
        help="저장될 학생, 범위와 시험 조건을 마지막으로 확인합니다."
        helpLabel="오답 시험 미리보기 설명"
        index={4}
        title="미리보기"
      >
        <DirectReviewPreview rows={previewRows} />
      </AssignmentSection>
    </div>
  );
}
