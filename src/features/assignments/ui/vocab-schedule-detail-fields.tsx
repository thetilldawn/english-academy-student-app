"use client";

import { Button } from "@/design-system/primitives/button/button";
import { MetaTag } from "@/design-system/primitives/badge/badge";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";

import type { VocabScheduleSlotOverride, VocabTimeTemplate } from "../domain/vocab-assignment-contract";
import type { VocabScheduleSessionRow } from "../presentation/vocab-schedule-view";
import { followUpReleaseLabel } from "../presentation/assignment-release-view";
import styles from "./vocab-assignment-planner.module.css";

export type VocabScheduleDetailFieldsProps = {
  availableTimeEnabled: boolean;
  sessionRows: readonly VocabScheduleSessionRow[];
  timeTemplates: readonly VocabTimeTemplate[];
  templateName: string;
  templateSaving: boolean;
  onSessionScheduleChange: (session: number, value: VocabScheduleSlotOverride) => void;
  onApplyTemplate: (template: VocabTimeTemplate) => void;
  onTemplateNameChange: (name: string) => void;
  onSaveTemplate: () => void;
};

export function VocabScheduleDetailFields({
  availableTimeEnabled, sessionRows, timeTemplates, templateName, templateSaving,
  onSessionScheduleChange, onApplyTemplate, onTemplateNameChange, onSaveTemplate,
}: VocabScheduleDetailFieldsProps) {
  return (
    <>
      {sessionRows.length > 0 ? (
        <div className={styles.sessionTimeArea}>
          <FieldLabel as="span">회차별 시간</FieldLabel>
          {sessionRows.map((row) => {
            const { availableError, deadlineError } = row;
            const followUp = followUpReleaseLabel(row.sessionNumber);
            if (!row.editable) {
              return (
                <div
                  className={styles.sessionTimeRow}
                  key={row.sessionNumber}
                >
                  <span className={styles.sessionTimeIdentity}>
                    <strong>
                      {row.label}
                    </strong>
                    {followUp ? <MetaTag tone="neutral">{followUp}</MetaTag> : null}
                  </span>
                  <span className={styles.generatedSessionTime}>
                    {row.generatedTimeLabel}
                  </span>
                </div>
              );
            }
            return (
              <div className={styles.sessionTimeRow} key={row.sessionNumber}>
                <span className={styles.sessionTimeIdentity}>
                  <strong>
                    {row.label}
                  </strong>
                  {followUp ? <MetaTag tone="neutral">{followUp}</MetaTag> : null}
                </span>
                {availableTimeEnabled ? (
                  <Field as="label" className={styles.sessionAvailableField}>
                    <FieldLabel as="span">공개</FieldLabel>
                    <Input
                      aria-errormessage={availableError
                        ? `vocab-session-${row.sessionNumber}-available-error`
                        : undefined}
                      aria-invalid={Boolean(availableError)}
                      data-field-key={`session-${row.sessionNumber}-available`}
                      onChange={(event) =>
                        onSessionScheduleChange(
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
                ) : null}
                <Field as="label" className={styles.sessionDeadlineField}>
                  <FieldLabel as="span">마감</FieldLabel>
                  <Input
                    aria-errormessage={deadlineError
                      ? `vocab-session-${row.sessionNumber}-deadline-error`
                      : undefined}
                    aria-invalid={Boolean(deadlineError)}
                    data-field-key={`session-${row.sessionNumber}-deadline`}
                    onChange={(event) =>
                      onSessionScheduleChange(
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
        {timeTemplates.length > 0 ? (
          <div className={styles.templateButtons}>
            {timeTemplates.map((template) => (
              <Button
                key={template.id}
                onClick={() => onApplyTemplate(template)}
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
            onChange={(event) => onTemplateNameChange(event.target.value)}
            placeholder="예: 중3 저녁반"
            value={templateName}
          />
          <Button
            disabled={!templateName.trim() || templateSaving}
            onClick={onSaveTemplate}
            size="small"
          >
            {templateSaving ? "저장 중" : "저장"}
          </Button>
        </div>
      </div>
    </>
  );
}
