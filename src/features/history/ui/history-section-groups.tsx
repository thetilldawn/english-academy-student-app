"use client";

import { useState } from "react";

import { Button } from "@/design-system/primitives/button/button";
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
  const [visibleCounts, setVisibleCounts] = useState<
    Readonly<Record<string, number>>
  >({});
  return (
    <div className={styles.groups}>
      {sections.map((section) => {
        const visibleCount = visibleCounts[section.id] ?? 10;
        const visibleItems = section.items.slice(0, visibleCount);
        return (
          <CollapsibleStatusSection
            countLabel={`${section.items.length}${countSuffix}`}
            defaultOpen={section.defaultOpen ?? section.id === "open"}
            id={`history-${section.id}`}
            key={section.id}
            title={section.title}
          >
            <div className={styles.sectionContent}>
              <HistoryRows compact={compact} items={visibleItems} />
              {visibleCount < section.items.length ? (
                <Button
                  className={styles.loadMore}
                  onClick={() => setVisibleCounts((current) => ({
                    ...current,
                    [section.id]: (current[section.id] ?? 10) + 10,
                  }))}
                  variant="secondary"
                >
                  10개 더보기
                </Button>
              ) : null}
            </div>
          </CollapsibleStatusSection>
        );
      })}
    </div>
  );
}
