"use client";

import { useMemo, useState } from "react";

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

function takeHistorySections(sections: HistorySection[], limit: number) {
  return sections.reduce<{
    remaining: number;
    visible: (HistorySection & { totalItemCount: number })[];
  }>((result, section) => {
    if (result.remaining <= 0) return result;
    const items = section.items.slice(0, result.remaining);
    return {
      remaining: result.remaining - items.length,
      visible: items.length > 0
        ? [...result.visible, {
            ...section,
            items,
            totalItemCount: section.items.length,
          }]
        : result.visible,
    };
  }, { remaining: limit, visible: [] }).visible;
}

export function HistorySectionGroups({
  compact = false,
  countSuffix,
  sections,
}: {
  compact?: boolean;
  countSuffix: string;
  sections: HistorySection[];
}) {
  const [visibleCount, setVisibleCount] = useState(10);
  const totalCount = sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  const visibleSections = useMemo(
    () => takeHistorySections(sections, visibleCount),
    [sections, visibleCount],
  );

  return (
    <div className={styles.groups}>
      {visibleSections.map((section) => (
        <CollapsibleStatusSection
          countLabel={`${section.totalItemCount}${countSuffix}`}
          defaultOpen={section.defaultOpen ?? section.id === "open"}
          id={`history-${section.id}`}
          key={section.id}
          title={section.title}
        >
          <HistoryRows compact={compact} items={section.items} />
        </CollapsibleStatusSection>
      ))}
      {visibleCount < totalCount ? (
        <Button
          className={styles.loadMore}
          onClick={() => setVisibleCount((count) => count + 10)}
          variant="secondary"
        >
          10개 더보기
        </Button>
      ) : null}
    </div>
  );
}
