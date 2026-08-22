"use client";

import { useEffect, useRef } from "react";

import {
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { AssignmentDeadline } from "../domain/model";
import styles from "./exam-timing-fields.module.css";

function nextDayDefault() {
  return isoToKoreanDateTimeLocal(
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  );
}

export function AssignmentDeadlineFields({
  deadline,
  error,
  fieldKey = "deadline",
  id,
  onChange,
}: {
  deadline: AssignmentDeadline;
  error?: string;
  fieldKey?: string;
  id: string;
  onChange: (deadline: AssignmentDeadline) => void;
}) {
  const remembered = useRef(
    deadline.mode === "at" ? deadline.koreanLocalDateTime : "",
  );

  useEffect(() => {
    if (deadline.mode === "at") remembered.current = deadline.koreanLocalDateTime;
  }, [deadline]);

  const enabled = deadline.mode === "at";
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={styles.root} data-field-key={fieldKey} tabIndex={-1}>
      <label className={styles.toggle}>
        <Checkbox
          checked={enabled}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? {
                    mode: "at",
                    koreanLocalDateTime: remembered.current || nextDayDefault(),
                  }
                : { mode: "none" },
            )
          }
        />
        <span>응시 마감 사용</span>
      </label>
      <Field as="label" className={styles.control}>
        <FieldLabel as="span">마감</FieldLabel>
        <Input
          aria-errormessage={errorId}
          aria-invalid={Boolean(error)}
          disabled={!enabled}
          id={id}
          onChange={(event) =>
            onChange({
              mode: "at",
              koreanLocalDateTime: event.target.value,
            })
          }
          step={60}
          type="datetime-local"
          value={enabled ? deadline.koreanLocalDateTime : ""}
        />
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </Field>
      <span aria-hidden={enabled} className={styles.fixedStatus}>
        {enabled ? "\u00a0" : "마감 없이 응시합니다."}
      </span>
    </div>
  );
}
