"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { HelpTip } from "../tooltip/help-tip";

import styles from "./tabs.module.css";

export type TabItem<Value extends string> = {
  value: Value;
  label: string;
  controls?: string;
  describedBy?: string;
  disabled?: boolean;
  disabledReason?: string;
  id?: string;
};

export function Tabs<Value extends string>({
  ariaLabel,
  className = "",
  items,
  onChange,
  value,
  variant = "default",
}: {
  ariaLabel: string;
  className?: string;
  items: readonly TabItem<Value>[];
  onChange: (value: Value) => void;
  value: Value;
  variant?: "default" | "dialog";
}) {
  const fallbackId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const enabledIndices = items
      .map((item, itemIndex) => item.disabled ? -1 : itemIndex)
      .filter((itemIndex) => itemIndex >= 0);
    if (enabledIndices.length === 0) return;
    const currentEnabledIndex = enabledIndices.indexOf(index);
    const nextIndex = event.key === "Home"
      ? enabledIndices[0]!
      : event.key === "End"
        ? enabledIndices.at(-1)!
        : enabledIndices[
            (Math.max(currentEnabledIndex, 0) +
              (event.key === "ArrowRight" ? 1 : -1) +
              enabledIndices.length) % enabledIndices.length
          ]!;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.value);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      aria-label={ariaLabel}
      className={[styles.root, styles[variant], className]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        if (item.disabled && item.disabledReason) return (
          <HelpTip
            buttonRef={(node) => { tabRefs.current[index] = node; }}
            key={item.value}
            label={item.label}
            rootClassName={styles.tabHint}
            trigger={item.label}
            triggerProps={{
              "aria-controls": item.controls,
              "aria-describedby": item.describedBy,
              "aria-disabled": true,
              "aria-selected": false,
              className: styles.tab,
              id: item.id ?? `${fallbackId}-${item.value}`,
              onKeyDown: (event) => moveFocus(event, index),
              role: "tab",
              tabIndex: 0,
            }}
          >{item.disabledReason}</HelpTip>
        );
        return (
          <button
            aria-controls={item.controls}
            aria-describedby={item.describedBy}
            aria-selected={selected}
            className={styles.tab}
            disabled={item.disabled}
            id={item.id ?? `${fallbackId}-${item.value}`}
            key={item.value}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => moveFocus(event, index)}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
