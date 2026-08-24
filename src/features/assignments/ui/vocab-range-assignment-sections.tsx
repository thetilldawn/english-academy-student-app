"use client";

import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import { FieldLabel, Select } from "@/design-system/primitives/form/field";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";

import type { AssignmentStudentItem } from "../catalog-types";
import type { useVocabAssignmentScreen } from "../controller/use-vocab-assignment-screen";
import {
  hasVocabAssignmentFieldError,
  hasVocabScheduleFieldError,
  type VocabAssignmentFieldKey,
} from "../presentation/vocab-assignment-field-errors";
import { AssignmentSection } from "./assignment-section";
import { BulkExamFields } from "./bulk-exam-fields";
import { BulkSeriesPreview } from "./bulk-series-preview";
import { ExamTimingFields } from "./exam-timing-fields";
import { VocabQuestionFields, VocabRangeFields } from "./vocab-range-picker";
import { VocabScheduleFields } from "./vocab-schedule-fields";
import styles from "./vocab-assignment-planner.module.css";

type VocabAssignmentScreenController = ReturnType<
  typeof useVocabAssignmentScreen
>;

function previousSourceLabel(student: AssignmentStudentItem) {
  return [student.displayName, student.schoolName, student.gradeLabel]
    .filter(Boolean)
    .join(" · ");
}

export function VocabRangeAssignmentSections({
  busy,
  controller,
  fieldErrors,
  students,
}: {
  busy: boolean;
  controller: VocabAssignmentScreenController;
  fieldErrors: Partial<Record<VocabAssignmentFieldKey, string>>;
  students: readonly AssignmentStudentItem[];
}) {
  const bulk = controller.bulk;
  const previousSourceStudent = students.find(
    (student) => student.id === controller.previousExamSourceStudentId,
  );
  const rangeStatus = hasVocabAssignmentFieldError(fieldErrors, [
    "dataset",
    "range",
  ])
    ? "범위 확인"
    : null;
  const conditionStatus = hasVocabAssignmentFieldError(fieldErrors, [
    "distribution",
    "splitBasis",
    "questionCount",
    "selectionMode",
    "direction",
    "passingScore",
    "retryPassingScore",
  ])
    ? "조건 확인"
    : null;
  const scheduleStatus = hasVocabScheduleFieldError(fieldErrors)
    ? "일정 확인"
    : null;

  return (
    <div className={styles.plannerSections}>
      <AssignmentSection
        help="시험에 사용할 단어장과 범위를 고릅니다."
        helpLabel="시험 범위 설명"
        index={1}
        status={rangeStatus}
        title="시험 범위"
      >
        <VocabRangeFields
          controller={controller}
          datasets={controller.readyDatasets}
          fieldErrors={fieldErrors}
        />
      </AssignmentSection>
      <AssignmentSection
        help="범위를 나누는 방법과 시험 문제 순서, 통과 기준을 정합니다."
        helpLabel="시험 조건 설명"
        index={2}
        status={conditionStatus}
        title="시험 조건"
      >
        <VocabQuestionFields
          controller={controller}
          datasets={controller.readyDatasets}
          fieldErrors={fieldErrors}
        />
        <BulkExamFields
          controller={bulk}
          fieldErrors={fieldErrors}
        />
        <section aria-label="최근 시험 복사" className={styles.copyPanel}>
          <div className={styles.copySource}>
            <FieldLabel as="span" className={inlineHelpClassName}>
              <HelpTip label="최근 시험 설명" trigger="최근 시험">
                선택한 학생과 단어장의 최근 일반 시험에서 시험 조건과
                공개·마감 시간만 불러옵니다. 범위와 날짜는 바뀌지 않습니다.
              </HelpTip>
            </FieldLabel>
            {students.length > 1 ? (
              <Select
                aria-label="최근 시험 복사 기준 학생"
                onChange={(event) =>
                  controller.actions.changePreviousExamSourceStudentId(
                    event.target.value,
                  )
                }
                value={controller.previousExamSourceStudentId}
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {previousSourceLabel(student)}
                  </option>
                ))}
              </Select>
            ) : (
              <strong>
                {previousSourceStudent
                  ? previousSourceLabel(previousSourceStudent)
                  : "학생 선택 필요"}
              </strong>
            )}
            <small>
              {controller.previousExam
                ? controller.previousExam.assignmentTitle
                : "복사할 최근 시험 없음"}
            </small>
          </div>
          <Button
            disabled={!controller.hasPreviousExam || busy}
            onClick={() => {
              if (controller.actions.copyPreviousExam()) {
                toast.success("최근 시험 조건을 적용했습니다.");
              }
            }}
            size="small"
          >
            조건 복사
          </Button>
        </section>
      </AssignmentSection>
      <AssignmentSection
        help="요일을 고르면 기본 회차를 날짜에 배치합니다."
        helpLabel="시험 일정 설명"
        index={3}
        status={scheduleStatus}
        title="시험 일정"
      >
        <ExamTimingFields
          error={fieldErrors.timing}
          exam={bulk.state.draft.exam}
          onEnabledChange={bulk.actions.changeTimeLimitEnabled}
          onModeChange={bulk.actions.changeTimingMode}
          onTimingChange={bulk.actions.changeTiming}
        />
        <VocabScheduleFields
          controller={controller}
          fieldErrors={fieldErrors}
        />
      </AssignmentSection>
      <AssignmentSection
        help="학생에게 배정될 회차와 날짜를 마지막으로 확인합니다."
        helpLabel="시험 미리보기 설명"
        index={4}
        title="미리보기"
      >
        {controller.commonPlan ? (
          <BulkSeriesPreview
            completionGated={controller.distribution === "split"}
            controller={bulk}
            distribution={controller.distribution}
            students={students}
          />
        ) : (
          <div
            aria-live="polite"
            className={styles.reviewCalculation}
            data-status="idle"
            role="status"
          >
            시험 범위와 조건을 정하면 배정 내용이 표시됩니다.
          </div>
        )}
      </AssignmentSection>
    </div>
  );
}
