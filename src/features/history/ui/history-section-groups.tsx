import { CountBadge } from "@/design-system/primitives/badge/badge";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { HistoryRows } from "./history-rows";
import styles from "./history-section-groups.module.css";

export type HistorySection = {
  id: string;
  title: string;
  items: AssignmentHistorySummary[];
};

export function HistorySectionGroups({
  compact = false,
  countSuffix,
  sections,
}: {
  compact?: boolean;
  countSuffix: string;
  sections: HistorySection[];
}) {
  return (
    <div className={styles.groups}>
      {sections.map((section) => (
        <section
          aria-labelledby={`history-${section.id}`}
          className={styles.section}
          key={section.id}
        >
          <div className={styles.heading}>
            <h2 id={`history-${section.id}`}>{section.title}</h2>
            <CountBadge>
              {section.items.length}
              {countSuffix}
            </CountBadge>
          </div>
          <HistoryRows compact={compact} items={section.items} />
        </section>
      ))}
    </div>
  );
}
