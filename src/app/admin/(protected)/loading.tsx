import { adminShellText } from "@/content/ko/admin-shell";
import { ButtonSpinner } from "@/design-system/primitives/button/button";
import styles from "./route-state.module.css";

export default function AdminLoading() {
  return (
    <div aria-live="polite" className={styles.loading} role="status">
      <ButtonSpinner />
      <span>{adminShellText.loading}</span>
    </div>
  );
}
