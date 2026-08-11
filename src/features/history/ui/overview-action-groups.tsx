import { CountBadge } from "@/design-system/primitives/badge/badge";
import { adminOverviewText } from "@/content/ko/admin-overview";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import { HistoryRows } from "./history-rows";
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
    <div className={styles.groups}>
      {sections.map((section) => (
        <section
          aria-labelledby={`overview-${section.id}`}
          className={styles.section}
          key={section.id}
        >
          <div className={styles.heading}>
            <h2 id={`overview-${section.id}`}>{section.title}</h2>
            <CountBadge>
              {section.items.length}
              {adminOverviewText.countSuffix}
            </CountBadge>
          </div>
          <HistoryRows compact items={section.items} />
        </section>
      ))}
    </div>
  );
}

export function OverviewEmptyState() {
  return (
    <EmptyState className={styles.empty}>
      {adminOverviewText.emptyState}
    </EmptyState>
  );
}
