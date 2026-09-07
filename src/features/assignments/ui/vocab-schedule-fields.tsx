"use client";

import type { ReactNode } from "react";

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

import type { IsoWeekday, VocabScheduleDraft } from "../domain/vocab-assignment-contract";
import type { VocabScheduleCounts } from "../domain/vocab-schedule";
import type { VocabScheduleFieldErrors } from "../presentation/vocab-schedule-view";
import styles from "./vocab-assignment-planner.module.css";

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

export type VocabScheduleFieldsProps = {
  schedule: VocabScheduleDraft;
  scheduleEnabled: boolean;
  scheduleAllowed: boolean;
  scheduleMessage: string | null;
  datasetLabel: string;
  rangeLabel: string;
  counts: VocabScheduleCounts;
  fieldErrors?: Pick<VocabScheduleFieldErrors, "startDate" | "weekdays" | "availableTime" | "deadlineOffset" | "deadlineTime">;
  onScheduleEnabledChange: (enabled: boolean) => void;
  onScheduleChange: (patch: Partial<VocabScheduleDraft>) => void;
  onWeekdayToggle: (weekday: IsoWeekday) => void;
  onCancelExtraDates: () => void;
  onRepeatFromStart: () => void;
  details: ReactNode;
};

export function VocabScheduleFields({
  schedule, scheduleEnabled, scheduleAllowed, scheduleMessage, datasetLabel, rangeLabel,
  counts, fieldErrors = {}, onScheduleEnabledChange, onScheduleChange,
  onWeekdayToggle, onCancelExtraDates, onRepeatFromStart, details,
}: VocabScheduleFieldsProps) {
  const availableTimeEnabled = schedule.availableTimeEnabled !== false;
  const startDateError = fieldErrors.startDate;
  const weekdaysError = fieldErrors.weekdays;
  const availableTimeError = fieldErrors.availableTime;
  const deadlineOffsetError = fieldErrors.deadlineOffset;
  const deadlineTimeError = fieldErrors.deadlineTime;
  const { currentScheduleCount, remainingSessionCount } = counts;

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
            disabled={!scheduleAllowed}
            onChange={(event) =>
              onScheduleEnabledChange(event.target.checked)
            }
          />
          <span>사용</span>
        </label>
      </div>
      {scheduleMessage ? (
        <small role="status">
          {scheduleMessage}
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
            onScheduleChange({ startDate: event.target.value })
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
            {counts.sameRangeEverySession
              ? `선택한 날짜 ${currentScheduleCount}회 · 같은 범위 반복`
              : counts.baseSessionCount === null
              ? counts.capacityStatus === "different" ? "학생별 가능 회차가 다릅니다"
                : counts.capacityStatus === "error" ? "가능한 회차를 확인하지 못했습니다"
                : counts.capacityStatus === "unselected" ? "범위를 먼저 선택해 주세요"
                : counts.capacityStatus === "blocked" ? "배정 조건을 확인해 주세요"
                : "가능한 회차 확인 중"
              : `가능한 배정 ${counts.baseSessionCount}회`}
            {!counts.sameRangeEverySession && currentScheduleCount > 0 ? ` · 선택 ${currentScheduleCount}회` : ""}
            {!counts.sameRangeEverySession && currentScheduleCount > 0 && remainingSessionCount !== null
              ? ` · 남음 ${remainingSessionCount}회` : ""}
            {!counts.requiresExtraDateDecision &&
                counts.repeatCycleCount > 1
              ? ` · 범위 ${counts.repeatCycleCount}바퀴`
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
              onClick={() => onWeekdayToggle(weekday)}
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
      {counts.requiresExtraDateDecision ? (
        <div className={styles.warning} role="status">
          <span>
            기본 {counts.baseSessionCount}회보다 날짜가 많아 범위를 총 {counts.repeatCycleCount}바퀴 사용합니다. {counts.repeatCycleCount}번째 바퀴까지 처음부터 반복할까요?
          </span>
          <div className={styles.warningActions}>
            <Button
              onClick={onCancelExtraDates}
              size="small"
              variant="secondary"
            >
              추가 취소
            </Button>
            <Button
              onClick={onRepeatFromStart}
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
              onScheduleChange({
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
              onScheduleChange({ availableTime: event.target.value })
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
              onScheduleChange({
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
              onScheduleChange({ deadlineTime: event.target.value })
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
      {details}
        </div>
      </ConditionalReveal>
    </div>
  );
}
