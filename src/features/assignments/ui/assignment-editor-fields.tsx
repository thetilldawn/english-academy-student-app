import { useId, type ReactNode } from "react";

import {
  Field,
  FieldLabel,
} from "@/design-system/primitives/form/field";
import { SegmentedControl } from "@/design-system/primitives/form/segmented-control";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import type { TimingMode } from "@/lib/admin/assignment-settings";

import styles from "./assignment-editor-fields.module.css";

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function AssignmentFieldGrid({
  children,
  className,
  columns = 2,
}: {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={classNames(
        styles.fieldGrid,
        columns === 2 ? styles.fieldGridTwo : styles.fieldGridThree,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AssignmentSessionRow({
  className,
  details,
  error,
  heading,
}: {
  className?: string;
  details: ReactNode;
  error?: ReactNode;
  heading: ReactNode;
}) {
  return (
    <div className={classNames(styles.sessionRow, className)}>
      <div className={styles.sessionHeading}>{heading}</div>
      <div className={styles.sessionDetails}>{details}</div>
      {error ? <div className={styles.sessionError}>{error}</div> : null}
    </div>
  );
}

export function AssignmentTimingModeField({
  disabled = false,
  helpAriaLabel,
  helpText,
  label,
  mode,
  onChange,
  perQuestionLabel,
  totalLabel,
}: {
  disabled?: boolean;
  helpAriaLabel: string;
  helpText: ReactNode;
  label: ReactNode;
  mode: Exclude<TimingMode, "none">;
  onChange: (mode: Exclude<TimingMode, "none">) => void;
  perQuestionLabel: ReactNode;
  totalLabel: ReactNode;
}) {
  return (
    <AssignmentSegmentedField
      helpAriaLabel={helpAriaLabel}
      helpText={helpText}
      label={label}
      onChange={onChange}
      options={[
        { disabled, label: totalLabel, value: "total" },
        { disabled, label: perQuestionLabel, value: "per_question" },
      ]}
      value={mode}
    />
  );
}

export function AssignmentSegmentedField<Value extends string>({
  helpAriaLabel,
  helpText,
  label,
  onChange,
  options,
  value,
}: {
  helpAriaLabel: string;
  helpText: ReactNode;
  label: ReactNode;
  onChange: (value: Value) => void;
  options: ReadonlyArray<{
    disabled?: boolean;
    label: ReactNode;
    value: Value;
  }>;
  value: Value;
}) {
  const labelId = useId();

  return (
    <Field className={styles.segmentedField}>
      <FieldLabel as="span" id={labelId}>
        <HelpTip label={helpAriaLabel} trigger={label}>
          {helpText}
        </HelpTip>
      </FieldLabel>
      <SegmentedControl
        ariaLabelledBy={labelId}
        onChange={onChange}
        options={options}
        value={value}
      />
    </Field>
  );
}
