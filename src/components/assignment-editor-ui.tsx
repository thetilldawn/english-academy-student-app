import { useId, type ReactNode } from "react";

import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";
import type { TimingMode } from "@/lib/admin/assignment-settings";
import {
  Field,
  FieldLabel,
} from "@/design-system/primitives/form/field";
import { SegmentedControl } from "@/design-system/primitives/form/segmented-control";

import styles from "./assignment-editor-ui.module.css";

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function AssignmentEditorLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames(styles.layout, className)}>
      {children}
    </div>
  );
}

export function AssignmentEditorSettings({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames(styles.settings, className)}>
      {children}
    </div>
  );
}

export function AssignmentEditorSummary({
  busy,
  children,
  className,
}: {
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-busy={busy || undefined}
      className={classNames(styles.summary, className)}
    >
      {children}
    </aside>
  );
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
      {error ? (
        <div className={styles.sessionError}>{error}</div>
      ) : null}
    </div>
  );
}

export function AssignmentTimingModeField({
  helpAriaLabel,
  helpText,
  label,
  mode,
  onChange,
  perQuestionLabel,
  totalLabel,
}: {
  helpAriaLabel: string;
  helpText: ReactNode;
  label: ReactNode;
  mode: TimingMode;
  onChange: (mode: TimingMode) => void;
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
        { label: totalLabel, value: "total" },
        { label: perQuestionLabel, value: "per_question" },
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
      <FieldLabel as="span" className={inlineHelpClassName} id={labelId}>
        <span>{label}</span>
        <HelpTip label={helpAriaLabel}>{helpText}</HelpTip>
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
