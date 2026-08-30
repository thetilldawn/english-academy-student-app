import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { koreanDateTimeLocalToIso } from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
} from "../catalog-types";
import type {
  DirectReviewAssignmentController,
  DirectReviewFieldKey,
} from "../controller/use-direct-review-assignment-controller";
import type { ReviewLevel } from "../domain/model";
import { AssignmentAvailabilityFields } from "./assignment-availability-fields";
import { AssignmentDeadlineFields } from "./assignment-deadline-fields";
import { AssignmentSection } from "./assignment-section";
import {
  ExamConditionFields,
  ExamQuestionOrderField,
} from "./bulk-exam-fields";
import { ExamTimingFields } from "./exam-timing-fields";
import styles from "./vocab-assignment-planner.module.css";

function levelCountLabel(value: number | null) {
  return value === null ? "계산 전" : `${value}개`;
}

function selectedLevelLabel(levels: readonly ReviewLevel[]) {
  if (levels.length === 0) return "선택 안 함";
  return levels
    .map((level) => (level === 1 ? "1회" : "2회 이상"))
    .join(" · ");
}

function timingLabel(controller: DirectReviewAssignmentController) {
  const { exam } = controller.draft;
  if (exam.timeLimitEnabled === false) return "시간 제한 없음";
  return exam.timing.mode === "total"
    ? `전체 ${exam.timing.totalSeconds / 60}분`
    : `문제당 ${exam.timing.perQuestionSeconds}초`;
}

export function DirectReviewAssignmentSections({
  controller,
  datasets,
  fieldErrors,
  student,
}: {
  controller: DirectReviewAssignmentController;
  datasets: readonly AssignmentDatasetItem[];
  fieldErrors: Partial<Record<DirectReviewFieldKey, string>>;
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
  const countText = summary.status === "loading" || summary.status === "idle"
    ? "현재 오답 단어 계산 중…"
    : summary.status === "error"
      ? summary.message
      : controller.totalAvailableCount === 0
        ? "현재 배정할 오답이 없습니다."
        : capacity.status === "loading"
    ? "오답 단어 계산 중…"
    : capacity.status === "error"
      ? capacity.message
      : capacity.status === "ready"
        ? draft.questionCount > 0
          ? `단어 ${draft.questionCount}개`
          : "현재 배정할 오답이 없습니다."
        : "단어장과 오답 단계를 선택해 주세요.";
  const deadlineIso = draft.deadline.mode === "at"
    ? koreanDateTimeLocalToIso(draft.deadline.koreanLocalDateTime)
    : null;
  const availabilityIso = draft.availability.mode === "at"
    ? koreanDateTimeLocalToIso(draft.availability.koreanLocalDateTime)
    : null;

  return (
    <div className={styles.plannerSections}>
      <AssignmentSection
        help="학생의 미배정 오답을 단어장별로 다시 계산합니다."
        helpLabel="오답 시험 범위 설명"
        index={1}
        status={rangeStatus}
        title="시험 범위"
      >
        <div className={styles.reviewRangeGrid}>
          <Field>
            <FieldLabel as="span" id="review-dataset-label">단어장</FieldLabel>
            <div
              aria-describedby={fieldErrors.dataset
                ? "review-dataset-error"
                : undefined}
              aria-labelledby="review-dataset-label"
              className={styles.reviewDatasetButtons}
              data-field-key="dataset"
              role="group"
              tabIndex={-1}
            >
              <span className={styles.reviewDatasetTotal}>
                전체 {controller.totalAvailableCount}개
              </span>
              {controller.datasetOptions.map(({ dataset: candidate, count }) => (
                <Button
                  aria-pressed={draft.datasetId === candidate.id}
                  key={candidate.id}
                  onClick={() => controller.actions.changeDataset(candidate.id)}
                  size="small"
                  variant="filter"
                >
                  {cataloguedDatasetDisplayLabel(candidate)} {count}개
                </Button>
              ))}
            </div>
            {fieldErrors.dataset ? (
              <FieldError id="review-dataset-error">
                {fieldErrors.dataset}
              </FieldError>
            ) : !draft.datasetId && controller.totalAvailableCount > 0 ? (
              <small className={styles.rangeSummary}>
                시험을 배정할 단어장을 선택하세요.
              </small>
            ) : null}
          </Field>
          <Field>
            <FieldLabel as="span" id="review-level-label">
              <HelpTip label="틀린 횟수 설명" trigger="틀린 횟수">
                단어 시험에서 틀린 횟수입니다.
              </HelpTip>
            </FieldLabel>
            <div
              aria-labelledby="review-level-label"
              className={styles.reviewLevelButtons}
              data-field-key="reviewLevels"
              role="group"
              tabIndex={-1}
            >
              {([1, 2] as const).map((level) => {
                const count = level === 1
                  ? knownLevelCounts.level1
                  : knownLevelCounts.level2;
                const selected = draft.reviewLevels.includes(level);
                return (
                  <Button
                    aria-pressed={selected}
                    disabled={count === 0}
                    key={level}
                    onClick={() => controller.actions.toggleReviewLevel(level)}
                    size="small"
                    variant="filter"
                  >
                    {level === 1 ? "1회" : "2회 이상"} {levelCountLabel(count)}
                  </Button>
                );
              })}
            </div>
            {fieldErrors.reviewLevels ? (
              <FieldError>{fieldErrors.reviewLevels}</FieldError>
            ) : null}
          </Field>
        </div>
        <div data-field-key="preview" tabIndex={-1}>
          <div
            aria-live="polite"
            className={styles.reviewCalculation}
            data-field-key="questionCount"
            data-status={summary.status === "ready" ? capacity.status : summary.status}
            role="status"
            tabIndex={-1}
          >
            {countText}
          </div>
          {fieldErrors.questionCount ? (
            <FieldError>{fieldErrors.questionCount}</FieldError>
          ) : null}
        </div>
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
          exam={draft.exam}
          fieldErrors={fieldErrors}
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
          exam={draft.exam}
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
        <dl className={styles.reviewPreview}>
          <div><dt>학생</dt><dd>{student.displayName}</dd></div>
          <div>
            <dt>단어장</dt>
            <dd>{dataset ? cataloguedDatasetDisplayLabel(dataset) : "선택 전"}</dd>
          </div>
          <div><dt>범위</dt><dd>오답 · {selectedLevelLabel(draft.reviewLevels)}</dd></div>
          <div><dt>단어 수</dt><dd>{draft.questionCount}개</dd></div>
          <div>
            <dt>공개</dt>
            <dd>{availabilityIso ? formatKoreanDateTime(availabilityIso) : "즉시"}</dd>
          </div>
          <div><dt>시간</dt><dd>{timingLabel(controller)}</dd></div>
          <div>
            <dt>마감</dt>
            <dd>{deadlineIso ? formatKoreanDateTime(deadlineIso) : "마감 없음"}</dd>
          </div>
        </dl>
      </AssignmentSection>
    </div>
  );
}
