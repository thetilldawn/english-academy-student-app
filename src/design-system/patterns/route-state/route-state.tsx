import { ButtonLink, ButtonSpinner } from "@/design-system/primitives/button/button";

import styles from "./route-state.module.css";

export function RouteLoadingState({
  label,
  role = "status",
  variant = "page",
}: {
  label: string;
  role?: "status";
  variant?: "compact" | "page" | "shell";
}) {
  return (
    <div
      aria-live="polite"
      className={styles.loading}
      data-variant={variant}
      role={role}
    >
      <ButtonSpinner />
      <span>{label}</span>
    </div>
  );
}

export function PanelLoadFailure({
  message,
  retryHref,
  retryLabel,
}: {
  message: string;
  retryHref: string;
  retryLabel: string;
}) {
  return (
    <section className={styles.panelError} role="alert">
      <p>{message}</p>
      <ButtonLink href={retryHref} size="small" variant="secondary">
        {retryLabel}
      </ButtonLink>
    </section>
  );
}
