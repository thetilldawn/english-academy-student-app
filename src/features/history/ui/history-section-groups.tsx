import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { HistoryRows } from "./history-rows";
import styles from "./history-section-groups.module.css";

export type HistorySection = {
  defaultOpen?: boolean;
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
        <CollapsibleStatusSection
          countLabel={`${section.items.length}${countSuffix}`}
          defaultOpen={section.defaultOpen ?? section.id === "open"}
          id={`history-${section.id}`}
          key={section.id}
          title={section.title}
        >
          <HistoryRows compact={compact} items={section.items} />
        </CollapsibleStatusSection>
      ))}
    </div>
  );
}
