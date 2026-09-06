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
import { useVocabScheduleTemplateInput } from "../client/controllers/use-vocab-schedule-template-input";
import type { useVocabAssignmentScreen } from "../controller/use-vocab-assignment-screen";
import { resolveVocabScheduleCounts } from "../domain/vocab-schedule";
import { assignmentQuestionModePolicy } from "../domain/assignment-question-mode-policy";
import { assignmentQuestionModeView, assignmentQuestionModeScheduleMessage } from "../presentation/assignment-question-mode-view";
import { vocabScheduleLabels, vocabScheduleSessionRows } from "../presentation/vocab-schedule-view";
import {
  hasVocabAssignmentFieldError,
  hasVocabScheduleFieldError,
  type VocabAssignmentFieldKey,
} from "../presentation/vocab-assignment-field-errors";
import { AssignmentSection } from "./assignment-section";
import type { AssignmentDatasetTriggerProps } from "./assignment-dataset-trigger";
import { BulkExamFields } from "./bulk-exam-fields";
import { BulkSeriesPreview } from "./bulk-series-preview";
import { ExamTimingFields } from "./exam-timing-fields";
import { VocabQuestionSection } from "./vocab-range-picker";
import { VocabRangeFields } from "./vocab-range-fields";
import { VocabScheduleFields } from "./vocab-schedule-fields";
import { VocabScheduleDetailFields } from "./vocab-schedule-detail-fields";
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
  onOpenDatasetPicker,
  datasetTriggerRef,
  students,
  unitLoadState = { datasetId: "", message: "", status: "idle" },
}: {
  busy: boolean;
  controller: VocabAssignmentScreenController;
  fieldErrors: Partial<Record<VocabAssignmentFieldKey, string>>;
  onRetryUnits?: () => void;
  onOpenDatasetPicker: () => void;
  datasetTriggerRef?: AssignmentDatasetTriggerProps["triggerRef"];
  students: readonly AssignmentStudentItem[];
  unitLoadState?: {
    datasetId: string;
    message: string;
    status: "idle" | "loading" | "ready" | "error";
  };
}) {
  const bulk = controller.bulk;
  const questionPolicy = assignmentQuestionModePolicy(bulk.state.draft.questionMode);
  const questionModeView = assignmentQuestionModeView({
    questionMode: bulk.state.draft.questionMode,
    datasetSelected: Boolean(controller.planner.datasetId),
    availableModes: controller.questionModeAvailability,
  });
  const templateInput = useVocabScheduleTemplateInput({
    saving: controller.templateSaving,
    onSave: controller.actions.saveCurrentTemplate,
  });
  const schedule = controller.planner.schedule;
  const scheduleEnabled = controller.planner.scheduleEnabled !== false;
  const availableTimeEnabled = schedule.availableTimeEnabled !== false;
  const scheduleLabels = vocabScheduleLabels({
    selectedDataset: controller.readyDatasets?.find(dataset => dataset.id === controller.planner.datasetId),
    representativeDatasetLabel: bulk.preview?.items?.find(item => item.datasetLabel)?.datasetLabel,
    selectedUnits: controller.selectedUnits ?? [],
  });
  const scheduleCounts = resolveVocabScheduleCounts({
    scheduleEnabled,
    distribution: controller.distribution,
    slotCount: controller.scheduleSlots.length,
    defaultSessionCount: controller.defaultSessionCount,
    extraDateDecisionSessionCount: controller.extraDateDecisionSessionCount,
    requiresExtraDateDecision: controller.requiresExtraDateDecision,
    repeatCycleCount: controller.repeatCycleCount,
  });
  const scheduleRows = vocabScheduleSessionRows({
    slots: controller.scheduleSlots,
    hasSelectedWeekdays: schedule.weekdays.length > 0,
    previewSessions: bulk.preview?.commonPlanSummary?.sessions ?? [],
    distribution: controller.distribution,
    availableTimeEnabled,
    fieldErrors,
  });
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
          dataset={controller.readyDatasets.find((dataset) => dataset.id === controller.planner.datasetId)}
          units={controller.availableUnits}
          selectedUnitIds={controller.selectedUnits.map((unit) => unit.id)}
          datasetError={fieldErrors.dataset}
          rangeError={fieldErrors.range}
          onSelectUnit={controller.actions.selectUnit}
          onToggleAllUnits={controller.actions.selectAllUnits}
          onOpenDatasetPicker={onOpenDatasetPicker}
          datasetTriggerRef={datasetTriggerRef}
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
        <VocabQuestionSection
          controller={controller}
          fieldErrors={fieldErrors}
        />
        <BulkExamFields
          questionMode={questionModeView}
          questionOrder={bulk.state.draft.exam.questionOrderMode === "random" ? "random" : "sequential"}
          exam={{ directionRatio: bulk.state.draft.exam.directionRatio, passingScore: bulk.state.draft.exam.passingScore,
            retryEnabled: bulk.state.draft.exam.retryEnabled, retryPassingScore: bulk.state.draft.exam.retryPassingScore }}
          directionDisabled={questionPolicy.fixedDirectionRatio !== null}
          fieldErrors={{ direction: fieldErrors.direction, passingScore: fieldErrors.passingScore,
            retryPassingScore: fieldErrors.retryPassingScore, questionOrder: fieldErrors.questionOrder }}
          onQuestionModeChange={controller.actions.changeQuestionMode}
          onQuestionOrderChange={(value) => bulk.actions.changeOrder(value === "random" ? "random" : "ascending")}
          onDirectionChange={bulk.actions.changeDirection}
          onPassingScoreChange={bulk.actions.changePassingScore}
          onRetryEnabledChange={bulk.actions.changeRetryEnabled}
          onRetryPassingScoreChange={bulk.actions.changeRetryPassingScore}
        />
        <section aria-label="최근 시험 복사" className={styles.copyPanel}>
          <div className={styles.copySource}>
            <FieldLabel as="span" className={inlineHelpClassName}>
              <HelpTip label="최근 시험 설명" trigger="최근 시험">
                최근 일반 시험의 시험 조건과 공개·마감 시간을 불러옵니다.
                저장된 회차당 단위 수가 있으면 공통 값으로 적용하며, 범위와
                날짜는 바뀌지 않습니다. 과거 요일별 값은 새 배정에 복사하지
                않습니다. 출제 단어 선택은 현재 설정을 유지합니다.
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
          enabled={bulk.state.draft.exam.timeLimitEnabled !== false}
          timing={bulk.state.draft.exam.timing}
          onEnabledChange={bulk.actions.changeTimeLimitEnabled}
          onModeChange={bulk.actions.changeTimingMode}
          onTimingChange={bulk.actions.changeTiming}
        />
        <VocabScheduleFields
          schedule={schedule}
          scheduleEnabled={scheduleEnabled}
          scheduleAllowed={questionPolicy.schedule === "flexible"}
          scheduleMessage={assignmentQuestionModeScheduleMessage(bulk.state.draft.questionMode)}
          datasetLabel={scheduleLabels.datasetLabel}
          rangeLabel={scheduleLabels.rangeLabel}
          counts={scheduleCounts}
          fieldErrors={{
            startDate: fieldErrors.startDate,
            weekdays: fieldErrors.weekdays,
            availableTime: fieldErrors.availableTime,
            deadlineOffset: fieldErrors.deadlineOffset,
            deadlineTime: fieldErrors.deadlineTime,
          }}
          onScheduleEnabledChange={controller.actions.changeScheduleEnabled}
          onScheduleChange={controller.actions.updateSchedule}
          onWeekdayToggle={controller.actions.toggleWeekday}
          onCancelExtraDates={controller.actions.cancelExtraDates}
          onRepeatFromStart={() => controller.actions.changeExtraDatePolicy("repeat_from_start")}
          details={
            <VocabScheduleDetailFields
              availableTimeEnabled={availableTimeEnabled}
              sessionRows={scheduleRows}
              timeTemplates={controller.timeTemplates}
              templateName={templateInput.name}
              templateSaving={controller.templateSaving}
              onSessionScheduleChange={controller.actions.updateSessionSchedule}
              onApplyTemplate={controller.actions.applyTemplate}
              onTemplateNameChange={templateInput.setName}
              onSaveTemplate={templateInput.save}
            />
          }
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
            completionGated={
              controller.commonPlan.distribution === "split" &&
              controller.commonPlan.selectedDateCount > 0
            }
            message={bulk.message}
            preview={bulk.preview}
            previewLoading={bulk.previewLoading}
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
