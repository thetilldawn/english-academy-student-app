"use client";

import { useId, useRef, type KeyboardEvent } from "react";

import styles from "./tabs.module.css";

export type TabItem<Value extends string> = {
  value: Value;
  label: string;
  controls?: string;
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
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) %
            items.length;
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
        return (
          <button
            aria-controls={item.controls}
            aria-selected={selected}
            className={styles.tab}
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
