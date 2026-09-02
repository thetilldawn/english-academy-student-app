"use client";

import { AssignmentFieldGrid } from "./assignment-editor-fields";
import { Button } from "@/design-system/primitives/button/button";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import {
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";
import { ConditionalReveal } from "@/design-system/patterns/conditional-reveal/conditional-reveal";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";

import type { VocabAssignmentScreenController } from "../controller/use-vocab-assignment-screen";
import type { IsoWeekday } from "../domain/vocab-assignment-contract";
import type {
  VocabAssignmentFieldKey,
} from "../presentation/vocab-assignment-field-errors";
import { assignmentUnitRangeLabel } from "../presentation/assignment-unit-range-label";
import styles from "./vocab-assignment-planner.module.css";
import { VocabScheduleDetailFields } from "./vocab-schedule-detail-fields";

const weekdays: ReadonlyArray<readonly [IsoWeekday, string]> = [
  [1, "월"],
  [2, "화"],
  [3, "수"],
  [4, "목"],
  [5, "금"],
  [6, "토"],
  [7, "일"],
];
const deadlineOffsets = Array.from({ length: 31 }, (_, offset) => offset);

export function VocabScheduleFields({
  controller,
  fieldErrors = {},
}: {
  controller: VocabAssignmentScreenController;
  fieldErrors?: Partial<Record<VocabAssignmentFieldKey, string>>;
}) {
  const schedule = controller.planner.schedule;
  const scheduleEnabled = controller.planner.scheduleEnabled !== false;
  const canonicalQuestionMode =
    controller.bulk.state.draft.questionMode !== "book_meaning_choice";
  const availableTimeEnabled = schedule.availableTimeEnabled !== false;
  const startDateError = fieldErrors.startDate;
  const weekdaysError = fieldErrors.weekdays;
  const availableTimeError = fieldErrors.availableTime;
  const deadlineOffsetError = fieldErrors.deadlineOffset;
  const deadlineTimeError = fieldErrors.deadlineTime;
  const representative = controller.bulk.preview?.items?.find(
    (item) => item.datasetLabel,
  ) ?? null;
  const selectedDataset = controller.readyDatasets?.find(
    (dataset) => dataset.id === controller.planner.datasetId,
  ) ?? null;
  const datasetLabel = selectedDataset
    ? cataloguedDatasetDisplayLabel(selectedDataset)
    : representative?.datasetLabel ?? "단어장 미선택";
  const selectedUnits = controller.selectedUnits ?? [];
  const rangeLabel = selectedUnits.length === 0
    ? "범위 미선택"
    : assignmentUnitRangeLabel(
        selectedUnits.map((unit) => unit.label),
        selectedUnits.map((unit) => unit.sortIndex),
      );
  const baseSessionCount = controller.planner.assignmentMode === "per_session"
    ? selectedUnits.length
    : controller.requiresExtraDateDecision
      ? controller.extraDateDecisionSessionCount ?? controller.defaultSessionCount
      : controller.defaultSessionCount;
  const currentScheduleCount = !scheduleEnabled
    ? 1
    : controller.distribution === "repeat"
      ? controller.scheduleSlots.length
      : Math.min(controller.scheduleSlots.length, baseSessionCount ?? 0);
  const remainingSessionCount = controller.distribution === "repeat"
    ? 0
    : Math.max(0, (baseSessionCount ?? 0) - currentScheduleCount);

  return (
    <div className={styles.fieldStack}>
      {scheduleEnabled ? (
        <MetaTagList>
          <MetaTag size="large">{datasetLabel}</MetaTag>
          <MetaTag size="large">{rangeLabel}</MetaTag>
        </MetaTagList>
      ) : null}
      <div className={styles.toggleFieldHeading}>
        <FieldLabel as="span">시험일 사용</FieldLabel>
        <label className={styles.inlineToggle}>
          <Checkbox
            checked={scheduleEnabled}
            disabled={canonicalQuestionMode}
            onChange={(event) =>
              controller.actions.changeScheduleEnabled(event.target.checked)
            }
          />
          <span>사용</span>
        </label>
      </div>
      {canonicalQuestionMode ? (
        <small role="status">
          영영풀이·예문 시험은 현재 Preview에서 바로 배정 1회로 확인합니다.
        </small>
      ) : null}
      <ConditionalReveal open={scheduleEnabled}>
        <div className={styles.scheduleRevealContent}>
      <Field as="label">
        <FieldLabel as="span">배정 기준일</FieldLabel>
        <Input
          aria-errormessage={startDateError ? "vocab-start-date-error" : undefined}
          aria-invalid={Boolean(startDateError)}
          data-field-key="startDate"
          onChange={(event) =>
            controller.actions.updateSchedule({ startDate: event.target.value })
          }
          type="date"
          value={schedule.startDate}
        />
        {startDateError ? (
          <FieldError id="vocab-start-date-error">{startDateError}</FieldError>
        ) : null}
      </Field>
      <Field>
        <div className={styles.weekdayFieldHeading}>
          <FieldLabel as="span">요일</FieldLabel>
          <MetaTag size="large">
            배정 {currentScheduleCount}회
            {remainingSessionCount > 0
              ? ` · 남음 ${remainingSessionCount}회`
              : ""}
          </MetaTag>
        </div>
        <div
          aria-describedby={weekdaysError ? "vocab-weekdays-error" : undefined}
          aria-label="배정 요일"
          className={styles.weekdayButtons}
          data-field-key="weekdays"
          role="group"
          tabIndex={-1}
        >
          {weekdays.map(([weekday, label]) => (
            <Button
              aria-pressed={schedule.weekdays.includes(weekday)}
              key={weekday}
              onClick={() => controller.actions.toggleWeekday(weekday)}
              size="small"
              variant="filter"
            >
              {label}
            </Button>
          ))}
        </div>
        {weekdaysError ? (
          <FieldError id="vocab-weekdays-error">{weekdaysError}</FieldError>
        ) : null}
      </Field>
      {controller.requiresExtraDateDecision ? (
        <div className={styles.warning} role="status">
          <span>
            기본 {controller.extraDateDecisionSessionCount ?? controller.defaultSessionCount ?? 0}회보다 날짜가 많습니다. 추가 날짜에는 범위를 처음부터 반복할까요?
          </span>
          <div className={styles.warningActions}>
            <Button
              onClick={controller.actions.cancelExtraDates}
              size="small"
              variant="secondary"
            >
              추가 취소
            </Button>
            <Button
              onClick={() =>
                controller.actions.changeExtraDatePolicy("repeat_from_start")
              }
              size="small"
              variant="primary"
            >
              범위 반복
            </Button>
          </div>
        </div>
      ) : null}
      <div className={styles.toggleFieldHeading}>
        <FieldLabel as="span">공개 시간 사용</FieldLabel>
        <label className={styles.inlineToggle}>
          <Checkbox
            checked={availableTimeEnabled}
            onChange={(event) =>
              controller.actions.updateSchedule({
                availableTimeEnabled: event.target.checked,
              })
            }
          />
          <span>사용</span>
        </label>
      </div>
      <ConditionalReveal open={availableTimeEnabled}>
        <Field as="label">
          <FieldLabel as="span">공개 시간</FieldLabel>
          <Input
            aria-errormessage={availableTimeError
              ? "vocab-available-time-error"
              : undefined}
            aria-invalid={Boolean(availableTimeError)}
            data-field-key="availableTime"
            onChange={(event) =>
              controller.actions.updateSchedule({ availableTime: event.target.value })
            }
            type="time"
            value={schedule.availableTime}
          />
          {availableTimeError ? (
            <FieldError id="vocab-available-time-error">
              {availableTimeError}
            </FieldError>
          ) : null}
        </Field>
      </ConditionalReveal>
      <AssignmentFieldGrid columns={2}>
        <Field as="label">
          <FieldLabel as="span">마감일</FieldLabel>
          <Select
            aria-errormessage={deadlineOffsetError
              ? "vocab-deadline-offset-error"
              : undefined}
            aria-invalid={Boolean(deadlineOffsetError)}
            data-field-key="deadlineOffset"
            onChange={(event) =>
              controller.actions.updateSchedule({
                deadlineDayOffset: Number(event.target.value),
              })
            }
            value={schedule.deadlineDayOffset}
          >
            {deadlineOffsets.map((offset) => (
              <option key={offset} value={offset}>
                {offset === 0
                  ? "당일"
                  : offset === 1
                    ? "다음 날"
                    : `${offset}일 뒤`}
              </option>
            ))}
          </Select>
          {deadlineOffsetError ? (
            <FieldError id="vocab-deadline-offset-error">
              {deadlineOffsetError}
            </FieldError>
          ) : null}
        </Field>
        <Field as="label">
          <FieldLabel as="span">마감 시각</FieldLabel>
          <Input
            aria-errormessage={deadlineTimeError
              ? "vocab-deadline-time-error"
              : undefined}
            aria-invalid={Boolean(deadlineTimeError)}
            data-field-key="deadlineTime"
            onChange={(event) =>
              controller.actions.updateSchedule({ deadlineTime: event.target.value })
            }
            type="time"
            value={schedule.deadlineTime}
          />
          {deadlineTimeError ? (
            <FieldError id="vocab-deadline-time-error">
              {deadlineTimeError}
            </FieldError>
          ) : null}
        </Field>
      </AssignmentFieldGrid>
      <VocabScheduleDetailFields
        controller={controller}
        fieldErrors={fieldErrors}
      />
        </div>
      </ConditionalReveal>
    </div>
  );
}
