import type {
  FormEventHandler,
  ReactNode,
  Ref,
} from "react";

import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import {
  Tabs,
  type TabItem,
} from "@/design-system/primitives/tabs/tabs";

import styles from "./assignment-editor-shell.module.css";

export function AssignmentEditorForm({
  busy,
  children,
  formId,
  formRef,
  legend,
  onSubmit,
}: {
  busy: boolean;
  children: ReactNode;
  formId: string;
  formRef?: Ref<HTMLFormElement>;
  legend: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form
      aria-busy={busy}
      className={styles.form}
      id={formId}
      noValidate
      onSubmit={onSubmit}
      ref={formRef}
    >
      <fieldset className={styles.fieldset} disabled={busy}>
        <legend className="sr-only">{legend}</legend>
        {children}
      </fieldset>
    </form>
  );
}

export function AssignmentEditorModeTabs<Value extends string>({
  ariaLabel,
  items,
  onChange,
  value,
}: {
  ariaLabel: string;
  items: readonly TabItem<Value>[];
  onChange: (value: Value) => void;
  value: Value;
}) {
  return (
    <Tabs
      ariaLabel={ariaLabel}
      className={styles.modeTabs}
      items={items}
      onChange={onChange}
      value={value}
    />
  );
}

export function AssignmentEditorLockedMode({
  ariaLabel,
  label,
  title,
}: {
  ariaLabel: string;
  label: string;
  title: string;
}) {
  return (
    <MetaTagList aria-label={ariaLabel} className={styles.lockedMode}>
      <MetaTag title={title}>{label}</MetaTag>
    </MetaTagList>
  );
}

export function AssignmentEditorPanel({
  children,
  labelledBy,
  panelId,
}: {
  children: ReactNode;
  labelledBy?: string;
  panelId?: string;
}) {
  return (
    <div
      aria-labelledby={labelledBy}
      className={styles.panel}
      id={panelId}
      role={labelledBy ? "tabpanel" : undefined}
    >
      {children}
    </div>
  );
}
