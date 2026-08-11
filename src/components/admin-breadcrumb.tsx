import { adminShellText } from "@/content/ko/admin-shell";

import styles from "./admin-breadcrumb.module.css";

export function AdminBreadcrumb({
  current,
  section,
}: {
  current: string;
  section?: string;
}) {
  return (
    <nav
      aria-label={adminShellText.breadcrumb.ariaLabel}
      className={styles.breadcrumb}
    >
      {section ? <span>{section}</span> : null}
      {section ? <span aria-hidden="true">/</span> : null}
      <strong aria-current="page">{current}</strong>
    </nav>
  );
}
