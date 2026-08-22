import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
  Select,
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
import { AssignmentDeadlineFields } from "./assignment-deadline-fields";
import { AssignmentSection } from "./assignment-section";
import { ExamConditionFields } from "./bulk-exam-fields";
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
  const { capacity, draft, knownLevelCounts } = controller;
  const dataset = datasets.find((candidate) => candidate.id === draft.datasetId);
  const rangeStatus = fieldErrors.dataset || fieldErrors.reviewLevels ||
    fieldErrors.questionCount || fieldErrors.preview
    ? "범위 확인"
    : null;
  const conditionStatus = fieldErrors.direction || fieldErrors.questionOrder ||
    fieldErrors.passingScore
    ? "조건 확인"
    : null;
  const scheduleStatus = fieldErrors.timing || fieldErrors.deadline
    ? "일정 확인"
    : null;
  const countText = capacity.status === "loading"
    ? "오답 문항 계산 중…"
    : capacity.status === "error"
      ? capacity.message
      : capacity.status === "ready"
        ? draft.questionCount > 0
          ? `출제 ${draft.questionCount}문항`
          : "현재 배정할 오답이 없습니다."
        : "단어장과 오답 단계를 선택해 주세요.";
  const deadlineIso = draft.deadline.mode === "at"
    ? koreanDateTimeLocalToIso(draft.deadline.koreanLocalDateTime)
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
          <Field as="label">
            <FieldLabel as="span">단어장</FieldLabel>
            <Select
              aria-errormessage={fieldErrors.dataset
                ? "review-dataset-error"
                : undefined}
              aria-invalid={Boolean(fieldErrors.dataset)}
              data-field-key="dataset"
              onChange={(event) =>
                controller.actions.changeDataset(event.target.value)
              }
              value={draft.datasetId}
            >
              <option value="">단어장을 선택하세요</option>
              {datasets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {cataloguedDatasetDisplayLabel(candidate)}
                </option>
              ))}
            </Select>
            {fieldErrors.dataset ? (
              <FieldError id="review-dataset-error">
                {fieldErrors.dataset}
              </FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel as="span" id="review-level-label">
              <HelpTip label="오답 단계 설명" trigger="오답 단계">
                1회는 한 번 틀린 단어, 2회 이상은 반복해서 틀린 단어입니다.
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
        <div
          aria-live="polite"
          className={styles.reviewCalculation}
          data-status={capacity.status}
          role="status"
        >
          {countText}
        </div>
        {fieldErrors.questionCount ? (
          <FieldError>{fieldErrors.questionCount}</FieldError>
        ) : null}
      </AssignmentSection>

      <AssignmentSection
        help="오답 문항의 방향, 순서와 통과 점수를 정합니다."
        helpLabel="오답 시험 조건 설명"
        index={2}
        status={conditionStatus}
        title="시험 조건"
      >
        <div className={styles.reviewQuestionCount}>
          <span>문항 수</span>
          <strong>{draft.questionCount}문항</strong>
        </div>
        <ExamConditionFields
          exam={draft.exam}
          fieldErrors={fieldErrors}
          idPrefix="review"
          onDirectionChange={controller.actions.changeDirection}
          onOrderChange={controller.actions.changeOrder}
          onPassingScoreChange={controller.actions.changePassingScore}
          orderLabel="출제 순서"
        />
      </AssignmentSection>

      <AssignmentSection
        help="제한시간과 응시 마감 사용 여부를 각각 정합니다."
        helpLabel="오답 시험 일정 설명"
        index={3}
        status={scheduleStatus}
        title="시험 일정"
      >
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
          <div><dt>문항 수</dt><dd>{draft.questionCount}문항</dd></div>
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
