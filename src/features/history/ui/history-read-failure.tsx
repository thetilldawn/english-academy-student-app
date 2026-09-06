import { adminHistoryText } from "@/content/ko/admin-history";
import { Button } from "@/design-system/primitives/button/button";
import { PanelLoadFailure } from "@/design-system/patterns/route-state/route-state";
import {
  isHistoryAccessFailure,
  type AdminHistoryFailureKind,
} from "../contracts/admin-history-request-error";
import { historyReadFailureMessage } from "../presentation/history-read-failure";
import styles from "./history-section-groups.module.css";

export function HistoryReadFailure({
  failure,
  onRetry,
  expired = false,
}: {
  failure: AdminHistoryFailureKind;
  onRetry: () => void;
  expired?: boolean;
}) {
  const message = expired ? adminHistoryText.read.expired : historyReadFailureMessage(failure);
  if (isHistoryAccessFailure(failure)) {
    return <PanelLoadFailure message={message} retryHref="/admin/login" retryLabel={adminHistoryText.read.login} />;
  }
  return (
    <section className={styles.sectionContent} role="alert">
      <p className={styles.error}>{message}</p>
      <Button onClick={onRetry} type="button" variant="secondary">
        {adminHistoryText.read.retry}
      </Button>
    </section>
  );
}
