"use client";

import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
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
  onRetryUnits = () => undefined,
  students,
  unitLoadState = { datasetId: "", message: "", status: "idle" },
}: {
  busy: boolean;
  controller: VocabAssignmentScreenController;
  fieldErrors: Partial<Record<VocabAssignmentFieldKey, string>>;
  onRetryUnits?: () => void;
  students: readonly AssignmentStudentItem[];
  unitLoadState?: {
    datasetId: string;
    message: string;
    status: "idle" | "loading" | "ready" | "error";
  };
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
    "unitAllocationMode",
    "unitsPerSession",
    "questionCount",
    "overflowPolicy",
    "selectionMode",
    "direction",
    "questionOrder",
    "passingScore",
    "retryPassingScore",
  ]) || Object.keys(fieldErrors).some((key) => key.startsWith("weekday-"))
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
        {unitLoadState.datasetId === controller.planner.datasetId &&
        unitLoadState.status === "loading" ? (
          <div aria-busy="true" className={styles.reviewCalculation} role="status">
            범위를 불러오는 중…
          </div>
        ) : unitLoadState.datasetId === controller.planner.datasetId &&
          unitLoadState.status === "error" ? (
          <Notice role="alert" tone="danger">
            {unitLoadState.message}
            <Button onClick={onRetryUnits} size="small" variant="quiet">
              다시 불러오기
            </Button>
          </Notice>
        ) : null}
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
                최근 일반 시험의 시험 조건과 공개·마감 시간을 불러옵니다.
                저장된 회차별 단위 규칙이 있으면 함께 적용하며, 범위와 날짜는
                바뀌지 않습니다. 출제 단어 선택은 현재 설정을 유지합니다.
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
              {controller.previousExamStatus === "loading" ||
              controller.previousExamStatus === "idle"
                ? "최근 시험 확인 중…"
                : controller.previousExamStatus === "error"
                  ? controller.previousExamError
                  : controller.previousExam
                    ? controller.previousExam.assignmentTitle
                    : "복사할 최근 시험 없음"}
            </small>
          </div>
          {controller.previousExamStatus === "error" ? (
            <Button
              disabled={busy}
              onClick={() => void controller.actions.retryPreviousExam()}
              size="small"
              variant="quiet"
            >
              다시 불러오기
            </Button>
          ) : null}
          <Button
            disabled={
              !controller.hasPreviousExam ||
              controller.previousExamStatus !== "ready" ||
              busy
            }
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
            completionGated={controller.commonPlan.distribution === "split"}
            controller={bulk}
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
