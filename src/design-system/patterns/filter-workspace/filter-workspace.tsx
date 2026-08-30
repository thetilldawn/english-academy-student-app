"use client";

import type { ReactNode } from "react";

import { CountBadge } from "@/design-system/primitives/badge/badge";
import { Input } from "@/design-system/primitives/form/field";

import styles from "./filter-workspace.module.css";

export function FilterWorkspace({
  activeFilterCount,
  activeTags,
  children,
  className,
  filterLabel,
  filteringStatus,
  onQueryChange,
  query,
  searchAriaLabel,
  searchPlaceholder,
  summaryActions,
}: {
  activeFilterCount: number;
  activeTags?: ReactNode;
  children: ReactNode;
  className?: string;
  filterLabel: string;
  filteringStatus?: string;
  onQueryChange: (query: string) => void;
  query: string;
  searchAriaLabel: string;
  searchPlaceholder: string;
  summaryActions: ReactNode;
}) {
  return (
    <div className={[styles.workspace, className].filter(Boolean).join(" ")}>
      <label className={styles.searchField}>
        <span aria-hidden="true" className={styles.searchIcon}>
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
        </span>
        <span className="sr-only">{searchAriaLabel}</span>
        <Input
          leadingAdornment
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          type="search"
          value={query}
        />
      </label>

      <details className={styles.disclosure}>
        <summary>
          <span>{filterLabel}</span>
          <CountBadge>{activeFilterCount}</CountBadge>
        </summary>
        <div className={styles.groups}>{children}</div>
      </details>

      <div className={styles.summary}>
        <div className={styles.tags}>{activeTags}</div>
        <div className={styles.summaryActions}>
          {filteringStatus !== undefined ? (
            <span aria-live="polite" className={styles.filteringStatus}>
              {filteringStatus}
            </span>
          ) : null}
          {summaryActions}
        </div>
      </div>
    </div>
  );
}

export function FilterWorkspaceGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className={styles.chips}>{children}</div>
    </fieldset>
  );
}
