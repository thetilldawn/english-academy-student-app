"use client";

import { Button } from "@/design-system/primitives/button/button";
import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import type { AdminHistorySectionPage } from "@/features/history/contracts/admin-history-read-model";
import {
  type AdminHistoryLoadMoreContext,
  useAdminHistorySectionPage,
} from "@/features/history/controller/use-admin-history-section-page";
import { HistoryRows } from "./history-rows";
import styles from "./history-section-groups.module.css";

export type HistorySection = AdminHistorySectionPage & {
  defaultOpen?: boolean;
  title: string;
};

function HistorySectionGroup({
  compact,
  countSuffix,
  loadMoreContext,
  section,
}: {
  compact: boolean;
  countSuffix: string;
  loadMoreContext?: AdminHistoryLoadMoreContext;
  section: HistorySection;
}) {
  const { error, items, loadMore, loading, nextCursor, totalCount } =
    useAdminHistorySectionPage({ loadMoreContext, section });

  return (
    <CollapsibleStatusSection
      countLabel={`${totalCount}${countSuffix}`}
      defaultOpen={section.defaultOpen ?? section.groupKey === "open"}
      id={`history-${section.groupKey}`}
      title={section.title}
    >
      <div className={styles.sectionContent}>
        <HistoryRows compact={compact} items={items} />
        {error ? (
          <p className={styles.error} role="alert">{error}</p>
        ) : null}
        {nextCursor ? (
          <Button
            className={styles.loadMore}
            disabled={loading}
            onClick={() => void loadMore()}
            variant="secondary"
          >
            {loading ? "불러오는 중..." : "10개 더보기"}
          </Button>
        ) : null}
      </div>
    </CollapsibleStatusSection>
  );
}

export function HistorySectionGroups({
  compact = false,
  countSuffix,
  loadMoreContext,
  revision = "static",
  sections,
}: {
  compact?: boolean;
  countSuffix: string;
  loadMoreContext?: AdminHistoryLoadMoreContext;
  revision?: string;
  sections: HistorySection[];
}) {
  return (
    <div className={styles.groups}>
      {sections.map((section) => (
        <HistorySectionGroup
          compact={compact}
          countSuffix={countSuffix}
          key={`${section.version ?? revision}:${section.groupKey}`}
          loadMoreContext={loadMoreContext}
          section={section}
        />
      ))}
    </div>
  );
}
