"use client";

import { useEffect, useRef } from "react";

import {
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { ConditionalReveal } from "@/design-system/patterns/conditional-reveal/conditional-reveal";

import styles from "./exam-timing-fields.module.css";

export function AssignmentDateTimeToggleField({
  defaultValue,
  error,
  fieldKey,
  id,
  inputLabel,
  memoryKey,
  offText,
  onChange,
  toggleLabel,
  toggleLocked = false,
  toggleLockedText = "",
  value,
}: {
  defaultValue: () => string;
  error?: string;
  fieldKey: string;
  id: string;
  inputLabel: string;
  memoryKey: string;
  offText: string;
  onChange: (value: string | null) => void;
  toggleLabel: string;
  toggleLocked?: boolean;
  toggleLockedText?: string;
  value: string | null;
}) {
  const remembered = useRef(value ?? "");
  const previousMemoryKey = useRef(memoryKey);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasEnabled = useRef(value !== null);

  useEffect(() => {
    if (previousMemoryKey.current !== memoryKey) {
      remembered.current = value ?? "";
      previousMemoryKey.current = memoryKey;
    }
  }, [memoryKey, value]);

  useEffect(() => {
    if (value !== null) remembered.current = value;
  }, [value]);

  const enabled = value !== null;
  useEffect(() => {
    if (enabled && !wasEnabled.current) inputRef.current?.focus();
    wasEnabled.current = enabled;
  }, [enabled]);
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={styles.root} data-field-key={fieldKey} tabIndex={-1}>
      <label className={styles.toggle}>
        <Checkbox
          checked={enabled}
          disabled={toggleLocked}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? remembered.current || defaultValue()
                : null,
            )
          }
        />
        <span>{toggleLabel}</span>
      </label>
      <ConditionalReveal open={enabled}>
        <Field className={styles.control}>
          <FieldLabel htmlFor={id}>{inputLabel}</FieldLabel>
          <Input
            aria-errormessage={errorId}
            aria-invalid={Boolean(error)}
            id={id}
            onChange={(event) => onChange(event.target.value)}
            ref={inputRef}
            step={60}
            type="datetime-local"
            value={value ?? ""}
          />
          {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        </Field>
      </ConditionalReveal>
      <span aria-hidden={enabled} className={styles.fixedStatus}>
        {toggleLocked ? toggleLockedText : enabled ? "\u00a0" : offText}
      </span>
    </div>
  );
}
