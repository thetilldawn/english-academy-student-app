import { adminShellText } from "@/content/ko/admin-shell";

import styles from "./admin-breadcrumb.module.css";

export function AdminBreadcrumb({
  current,
  section,
  variant = "page",
}: {
  current: string;
  section?: string;
  variant?: "page" | "topbar";
}) {
  return (
    <nav
      aria-label={adminShellText.breadcrumb.ariaLabel}
      className={[
        styles.breadcrumb,
        variant === "topbar" ? styles.topbar : "",
      ].filter(Boolean).join(" ")}
    >
      {section ? <span>{section}</span> : null}
      {section ? <span aria-hidden="true">/</span> : null}
      <h1 aria-current="page">{current}</h1>
    </nav>
  );
}
