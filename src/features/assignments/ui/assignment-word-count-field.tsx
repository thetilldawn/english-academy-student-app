import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@/design-system/primitives/form/field";
import { NumericInput } from "@/design-system/primitives/form/numeric-input";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import styles from "./vocab-assignment-planner.module.css";

export function AssignmentWordCountField({
  allSelected,
  allLabel = "전체",
  disabled = false,
  error,
  errorId = "assignment-word-count-error",
  helpText,
  inputLabel = "단어 수",
  inputPlaceholder,
  max,
  min,
  onChange,
  onFocus,
  onSelectAll,
  value,
}: {
  allSelected: boolean;
  allLabel?: string;
  disabled?: boolean;
  error?: string;
  errorId?: string;
  helpText: ReactNode;
  inputLabel?: string;
  inputPlaceholder?: string;
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
          {allLabel}
        </Button>
        <NumericInput
          aria-errormessage={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          aria-label={inputLabel}
          data-active={!allSelected}
          disabled={disabled}
          max={max}
          min={min}
          onValueChange={(value) => onChange(value ?? Number.NaN)}
          onFocus={onFocus}
          placeholder={inputPlaceholder}
          required
          value={value}
        />
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
import type { ReactNode } from "react";
