import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import styles from "./vocab-assignment-planner.module.css";

export function AssignmentWordCountField({
  allSelected,
  disabled = false,
  error,
  errorId = "assignment-word-count-error",
  helpText,
  inputLabel = "단어 수",
  max,
  min,
  onChange,
  onFocus,
  onSelectAll,
  value,
}: {
  allSelected: boolean;
  disabled?: boolean;
  error?: string;
  errorId?: string;
  helpText: ReactNode;
  inputLabel?: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  onFocus?: () => void;
  onSelectAll: () => void;
  value: number | string;
}) {
  return (
    <Field>
      <FieldLabel as="span" id={`${errorId}-label`}>
        <HelpTip label="단어 수 설명" trigger="단어 수">
          {helpText}
        </HelpTip>
      </FieldLabel>
      <div
        aria-describedby={error ? errorId : undefined}
        aria-labelledby={`${errorId}-label`}
        className={styles.wordCountControls}
        data-field-key="questionCount"
        role="group"
        tabIndex={-1}
      >
        <Button
          aria-pressed={allSelected}
          disabled={disabled}
          onClick={onSelectAll}
          size="small"
          variant="filter"
        >
          전체
        </Button>
        <Input
          aria-errormessage={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          aria-label={inputLabel}
          data-active={!allSelected}
          disabled={disabled}
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          onFocus={onFocus}
          required
          type="number"
          value={value}
        />
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
import type { ReactNode } from "react";
