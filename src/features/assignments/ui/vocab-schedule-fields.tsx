"use client";

import { useState } from "react";
import { toast } from "sonner";

import { AssignmentFieldGrid } from "@/components/assignment-editor-ui";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
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

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeading}>날짜 · 시간</h3>
      <Field as="label">
        <FieldLabel as="span">첫 배정 가능일</FieldLabel>
        <Input
          onChange={(event) =>
            controller.actions.updateSchedule({ startDate: event.target.value })
          }
          type="date"
          value={schedule.startDate}
        />
      </Field>
      <Field>
        <FieldLabel as="span">요일</FieldLabel>
        <div className={styles.weekdayButtons} role="group" aria-label="배정 요일">
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
      </Field>
      <AssignmentFieldGrid columns={3}>
        <Field as="label">
          <FieldLabel as="span">공개 시작</FieldLabel>
          <Input
            onChange={(event) =>
              controller.actions.updateSchedule({ availableTime: event.target.value })
            }
            type="time"
            value={schedule.availableTime}
          />
        </Field>
        <Field as="label">
          <FieldLabel as="span">마감일</FieldLabel>
          <Select
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
        </Field>
        <Field as="label">
          <FieldLabel as="span">마감 시각</FieldLabel>
          <Input
            onChange={(event) =>
              controller.actions.updateSchedule({ deadlineTime: event.target.value })
            }
            type="time"
            value={schedule.deadlineTime}
          />
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
              </Field>
              <Field as="label">
                <FieldLabel as="span">마감</FieldLabel>
                <Input
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
        선택 요일 {controller.planner.schedule.weekdays.length}개 · 배정 회차 {controller.scheduleSlots.length}회
        {controller.splitScheduleIssue
          ? ` · 나누려면 DAY를 ${controller.scheduleSlots.length}개 이상 선택하세요`
          : ""}
      </span>
    </section>
  );
}
