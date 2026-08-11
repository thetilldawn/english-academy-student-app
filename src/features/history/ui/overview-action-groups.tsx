import { adminOverviewText } from "@/content/ko/admin-overview";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import { HistorySectionGroups } from "./history-section-groups";
import styles from "./overview-action-groups.module.css";

type OverviewSection = {
  id: string;
  title: string;
  items: AssignmentHistorySummary[];
};

export function OverviewActionGroups({
  sections,
}: {
  sections: OverviewSection[];
}) {
  return (
    <HistorySectionGroups
      compact
      countSuffix={adminOverviewText.countSuffix}
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
