"use client";

import { useId, useState, type ReactNode } from "react";

import { CountBadge } from "../../primitives/badge/badge";

import styles from "./collapsible-status-section.module.css";

export function CollapsibleStatusSection({
  children,
  countLabel,
  defaultOpen = false,
  headingLevel = 2,
  id,
  title,
}: {
  children: ReactNode;
  countLabel: ReactNode;
  defaultOpen?: boolean;
  headingLevel?: 2 | 3 | 4;
  id?: string;
  title: string;
}) {
  const generatedId = useId();
  const baseId = id ?? `status-section-${generatedId.replaceAll(":", "")}`;
  const headingId = `${baseId}-heading`;
  const panelId = `${baseId}-panel`;
  const countId = `${baseId}-count`;
  const [open, setOpen] = useState(defaultOpen);
  const Heading = headingLevel === 2 ? "h2" : headingLevel === 3 ? "h3" : "h4";

  return (
    <section className={styles.root} data-open={open}>
      <div className={styles.header}>
        <Heading className={styles.heading} id={headingId}>
          <button
            aria-controls={panelId}
            aria-describedby={countId}
            aria-expanded={open}
            className={styles.trigger}
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span className={styles.title}>{title}</span>
            <span aria-hidden="true" className={styles.indicator} />
          </button>
        </Heading>
        <CountBadge id={countId}>
          {countLabel}
        </CountBadge>
      </div>
      <div
        aria-hidden={!open}
        aria-labelledby={headingId}
        className={styles.panel}
        id={panelId}
        inert={!open}
        role="region"
      >
        <div className={styles.content}>{children}</div>
      </div>
    </section>
  );
}
