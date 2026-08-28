import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";

import { HistoryActivityRow } from "./history-activity-row";
import styles from "./history-list.module.css";

export function HistoryRows({
  compact = false,
  items,
  showStudent = true,
}: {
  compact?: boolean;
  items: readonly AdminHistoryListItem[];
  showStudent?: boolean;
}) {
  return (
    <ol className={styles.list}>
      {items.map((item) => (
        <li key={item.id}>
          <HistoryActivityRow
            compact={compact}
            item={item}
            showScore={compact ? "meaningful" : "always"}
            showStudent={showStudent}
          />
        </li>
      ))}
    </ol>
  );
}
