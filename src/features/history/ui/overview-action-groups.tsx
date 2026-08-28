import { adminOverviewText } from "@/content/ko/admin-overview";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import {
  HistorySectionGroups,
  type HistorySection,
} from "./history-section-groups";
import styles from "./overview-action-groups.module.css";

export function OverviewActionGroups({
  revision,
  sections,
}: {
  revision: string;
  sections: HistorySection[];
}) {
  return (
    <HistorySectionGroups
      compact
      countSuffix={adminOverviewText.countSuffix}
      loadMoreContext={{
        currentOnly: true,
        query: "",
        statusFilter: "all",
      }}
      revision={revision}
      sections={sections}
    />
  );
}

export function OverviewEmptyState() {
  return (
    <EmptyState className={styles.empty}>
      {adminOverviewText.emptyState}
    </EmptyState>
  );
}
