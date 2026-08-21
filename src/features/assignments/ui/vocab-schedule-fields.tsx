"use client";

import { useState } from "react";
import { toast } from "sonner";

import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
} from "@/design-system/primitives/form/field";

import type { VocabAssignmentScreenController } from "../controller/use-vocab-assignment-screen";
import type { IsoWeekday } from "../domain/vocab-assignment-plan";
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

function sessionDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
        weekday: "short",
        timeZone: "UTC",
      }).format(parsed);
}

export function VocabScheduleFields({
  controller,
}: {
  controller: VocabAssignmentScreenController;
}) {
  const [templateName, setTemplateName] = useState("");
  const schedule = controller.planner.schedule;
  const startDateError = controller.fieldErrors.startDate;
  const weekdaysError = controller.fieldErrors.weekdays;
  const availableTimeError = controller.fieldErrors.availableTime;
  const deadlineOffsetError = controller.fieldErrors.deadlineOffset;
  const deadlineTimeError = controller.fieldErrors.deadlineTime;
  const previewSessionCount = Math.max(
    0,
    ...(controller.bulk.preview?.items?.map(
      (item) => item.sessions.length,
    ) ?? []),
  );
  const finalSessionCount =
    controller.bulk.preview?.commonPlanSummary?.sessions.length ??
    (previewSessionCount || controller.scheduleSlots.length);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeading}>날짜 · 시간</h3>
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
        <FieldLabel as="span">요일</FieldLabel>
        <div
          aria-describedby={weekdaysError ? "vocab-weekdays-error" : undefined}
          aria-label="배정 요일"
          className={styles.weekdayButtons}
          data-field-key="weekdays"
          data-invalid={Boolean(weekdaysError)}
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
      <AssignmentFieldGrid columns={3}>
        <Field as="label">
          <FieldLabel as="span">공개 시작</FieldLabel>
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
      {controller.scheduleSlots.length > 0 ? (
        <div className={styles.sessionTimeArea}>
          <FieldLabel as="span">회차별 시간</FieldLabel>
          {controller.scheduleSlots.map((slot) => (
            <div className={styles.sessionTimeRow} key={slot.sessionNumber}>
              <strong>
                {slot.sessionNumber}회차 · {sessionDateLabel(slot.date)}
              </strong>
              <Field as="label">
                <FieldLabel as="span">공개 시작</FieldLabel>
                <Input
                  aria-errormessage={controller.fieldErrors[`session-${slot.sessionNumber}-available`]
                    ? `vocab-session-${slot.sessionNumber}-available-error`
                    : undefined}
                  aria-invalid={Boolean(controller.fieldErrors[`session-${slot.sessionNumber}-available`])}
                  data-field-key={`session-${slot.sessionNumber}-available`}
                  onChange={(event) =>
                    controller.actions.updateSessionSchedule(
                      slot.sessionNumber,
                      {
                        availableLocalDateTime: event.target.value,
                        deadlineLocalDateTime: slot.deadlineLocalDateTime,
                      },
                    )
                  }
                  type="datetime-local"
                  value={slot.availableLocalDateTime}
                />
                {controller.fieldErrors[`session-${slot.sessionNumber}-available`] ? (
                  <FieldError id={`vocab-session-${slot.sessionNumber}-available-error`}>
                    {controller.fieldErrors[`session-${slot.sessionNumber}-available`]}
                  </FieldError>
                ) : null}
              </Field>
              <Field as="label">
                <FieldLabel as="span">마감</FieldLabel>
                <Input
                  aria-errormessage={controller.fieldErrors[`session-${slot.sessionNumber}-deadline`]
                    ? `vocab-session-${slot.sessionNumber}-deadline-error`
                    : undefined}
                  aria-invalid={Boolean(controller.fieldErrors[`session-${slot.sessionNumber}-deadline`])}
                  data-field-key={`session-${slot.sessionNumber}-deadline`}
                  onChange={(event) =>
                    controller.actions.updateSessionSchedule(
                      slot.sessionNumber,
                      {
                        availableLocalDateTime: slot.availableLocalDateTime,
                        deadlineLocalDateTime: event.target.value,
                      },
                    )
                  }
                  type="datetime-local"
                  value={slot.deadlineLocalDateTime}
                />
                {controller.fieldErrors[`session-${slot.sessionNumber}-deadline`] ? (
                  <FieldError id={`vocab-session-${slot.sessionNumber}-deadline-error`}>
                    {controller.fieldErrors[`session-${slot.sessionNumber}-deadline`]}
                  </FieldError>
                ) : null}
              </Field>
            </div>
          ))}
        </div>
      ) : null}
      <div className={styles.templateArea}>
        <FieldLabel as="span">빠른 시간</FieldLabel>
        <div className={styles.templateButtons}>
          {controller.timeTemplates.map((template) => (
            <Button
              key={template.id}
              onClick={() => controller.actions.applyTemplate(template)}
              size="small"
              variant="filter"
            >
              {template.label}
            </Button>
          ))}
        </div>
        <div className={styles.templateSave}>
          <Input
            aria-label="새 시간 템플릿 이름"
            maxLength={30}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="현재 시간을 템플릿으로 저장"
            value={templateName}
          />
          <Button
            disabled={!templateName.trim() || controller.templateSaving}
            onClick={async () => {
              const result = await controller.actions.saveCurrentTemplate(
                templateName,
              );
              if (result.ok) {
                setTemplateName("");
                toast.success("시간 템플릿을 저장했습니다.");
              } else {
                toast.error(result.message);
              }
            }}
            size="small"
          >
            {controller.templateSaving ? "저장 중" : "추가"}
          </Button>
        </div>
      </div>
      <span className={styles.candidateSummary}>
        선택 요일 {controller.planner.schedule.weekdays.length}개 · 기본 회차 {controller.scheduleSlots.length}회
        {finalSessionCount !== controller.scheduleSlots.length
          ? ` · 최종 ${finalSessionCount}회`
          : ""}
      </span>
    </section>
  );
}
