import type { ReactNode } from "react";

import styles from "./segmented-control.module.css";

export function SegmentedControl<Value extends string>({
  ariaLabelledBy,
  onChange,
  options,
  value,
}: {
  ariaLabelledBy: string;
  onChange: (value: Value) => void;
  options: ReadonlyArray<{
    disabled?: boolean;
    label: ReactNode;
    value: Value;
  }>;
  value: Value;
}) {
  return (
    <div
      aria-labelledby={ariaLabelledBy}
      className={styles.root}
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={styles.option}
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
