import { useId, type ReactNode } from "react";

import { HelpTip } from "@/components/help-tip";
import type { TimingMode } from "@/lib/admin/assignment-settings";
import {
  Field,
  FieldLabel,
} from "@/design-system/primitives/form/field";
import { SegmentedControl } from "@/design-system/primitives/form/segmented-control";

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
    <div className={classNames("assignment-editor-layout", className)}>
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
    <div className={classNames("assignment-editor-settings", className)}>
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
      className={classNames("assignment-editor-summary", className)}
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
        "assignment-field-grid",
        `assignment-field-grid--${columns}`,
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
    <div className={classNames("assignment-session-row", className)}>
      <div className="assignment-session-row-heading">{heading}</div>
      <div className="assignment-session-row-details">{details}</div>
      {error ? (
        <div className="assignment-session-row-error">{error}</div>
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
    <Field className="segmented-field">
      <FieldLabel as="span" className="label-with-help" id={labelId}>
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
