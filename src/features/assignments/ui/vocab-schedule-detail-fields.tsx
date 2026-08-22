"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import { MetaTag } from "@/design-system/primitives/badge/badge";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { VocabAssignmentScreenController } from "../controller/use-vocab-assignment-screen";
import type {
  VocabAssignmentFieldKey,
} from "../presentation/vocab-assignment-field-errors";
import styles from "./vocab-assignment-planner.module.css";

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

export function VocabScheduleDetailFields({
  controller,
  fieldErrors,
}: {
  controller: VocabAssignmentScreenController;
  fieldErrors: Partial<Record<VocabAssignmentFieldKey, string>>;
}) {
  const [templateName, setTemplateName] = useState("");
  const summary = controller.bulk.preview?.commonPlanSummary ?? null;
  const previewSessions = controller.planner.schedule.weekdays.length > 0
    ? summary?.sessions ?? []
    : [];
  const sessionRowCount = Math.max(
    controller.scheduleSlots.length,
    previewSessions.length,
  );
  const sessionRows = Array.from({ length: sessionRowCount }, (_, index) => {
    const slot = controller.scheduleSlots[index] ?? null;
    const preview = previewSessions[index] ?? null;
    const availableLocalDateTime = slot?.availableLocalDateTime ??
      (preview ? isoToKoreanDateTimeLocal(preview.availableFrom) : "");
    const deadlineLocalDateTime = slot?.deadlineLocalDateTime ??
      (preview?.availableUntil
        ? isoToKoreanDateTimeLocal(preview.availableUntil)
        : "");
    return {
      availableLocalDateTime,
      date: slot?.date ?? availableLocalDateTime.slice(0, 10),
      deadlineLocalDateTime,
      editableSlot: slot,
      questionCount: preview?.questionCount ?? null,
      queued:
        controller.planner.distribution === "split" &&
        (preview?.sessionNumber ?? slot?.sessionNumber ?? index + 1) > 1,
      sessionNumber: preview?.sessionNumber ?? slot?.sessionNumber ?? index + 1,
    };
  });

  return (
    <>
      {sessionRows.length > 0 ? (
        <div className={styles.sessionTimeArea}>
          <FieldLabel as="span">회차별 시간</FieldLabel>
          {sessionRows.map((row) => {
            const availableError =
              fieldErrors[`session-${row.sessionNumber}-available`];
            const deadlineError =
              fieldErrors[`session-${row.sessionNumber}-deadline`];
            if (!row.editableSlot) {
              return (
                <div
                  className={styles.sessionTimeRow}
                  key={row.sessionNumber}
                >
                  <strong>
                    {row.sessionNumber}회차 · {sessionDateLabel(row.date)}
                    {row.questionCount === null
                      ? ""
                      : ` · ${row.questionCount}문항`}
                  </strong>
                  {row.queued ? <MetaTag tone="neutral">완료 후 생성</MetaTag> : null}
                  <span className={styles.generatedSessionTime}>
                    {row.availableLocalDateTime.slice(11, 16)} 공개
                    {row.deadlineLocalDateTime
                      ? ` · ${row.deadlineLocalDateTime.slice(0, 10)} ${row.deadlineLocalDateTime.slice(11, 16)} 마감`
                      : ""}
                  </span>
                </div>
              );
            }
            return (
              <div className={styles.sessionTimeRow} key={row.sessionNumber}>
                <strong>
                  {row.sessionNumber}회차 · {sessionDateLabel(row.date)}
                  {row.questionCount === null
                    ? ""
                    : ` · ${row.questionCount}문항`}
                </strong>
                {row.queued ? <MetaTag tone="neutral">완료 후 생성</MetaTag> : null}
                <Field as="label">
                  <FieldLabel as="span">공개</FieldLabel>
                  <Input
                    aria-errormessage={availableError
                      ? `vocab-session-${row.sessionNumber}-available-error`
                      : undefined}
                    aria-invalid={Boolean(availableError)}
                    data-field-key={`session-${row.sessionNumber}-available`}
                    onChange={(event) =>
                      controller.actions.updateSessionSchedule(
                        row.sessionNumber,
                        {
                          availableLocalDateTime: event.target.value,
                          deadlineLocalDateTime: row.deadlineLocalDateTime,
                        },
                      )
                    }
                    type="datetime-local"
                    value={row.availableLocalDateTime}
                  />
                  {availableError ? (
                    <FieldError id={`vocab-session-${row.sessionNumber}-available-error`}>
                      {availableError}
                    </FieldError>
                  ) : null}
                </Field>
                <Field as="label">
                  <FieldLabel as="span">마감</FieldLabel>
                  <Input
                    aria-errormessage={deadlineError
                      ? `vocab-session-${row.sessionNumber}-deadline-error`
                      : undefined}
                    aria-invalid={Boolean(deadlineError)}
                    data-field-key={`session-${row.sessionNumber}-deadline`}
                    onChange={(event) =>
                      controller.actions.updateSessionSchedule(
                        row.sessionNumber,
                        {
                          availableLocalDateTime: row.availableLocalDateTime,
                          deadlineLocalDateTime: event.target.value,
                        },
                      )
                    }
                    type="datetime-local"
                    value={row.deadlineLocalDateTime}
                  />
                  {deadlineError ? (
                    <FieldError id={`vocab-session-${row.sessionNumber}-deadline-error`}>
                      {deadlineError}
                    </FieldError>
                  ) : null}
                </Field>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className={styles.templateArea}>
        <FieldLabel as="span" className={inlineHelpClassName}>
          <HelpTip label="시간 템플릿 설명" trigger="시간 템플릿">
            현재 공개·마감·제한시간을 저장해 다음 배정에서 바로 적용합니다.
          </HelpTip>
        </FieldLabel>
        {controller.timeTemplates.length > 0 ? (
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
        ) : null}
        <div className={styles.templateSave}>
          <Input
            aria-label="새 시간 템플릿 이름"
            maxLength={30}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="예: 중3 저녁반"
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
              } else toast.error(result.message);
            }}
            size="small"
          >
            {controller.templateSaving ? "저장 중" : "저장"}
          </Button>
        </div>
      </div>
    </>
  );
}
