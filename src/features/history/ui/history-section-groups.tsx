"use client";

import { useCallback, useEffect, useState } from "react";
import { createHistoryRefreshCoordinator, type HistoryFreshSectionReader } from "../controller/history-refresh-coordinator";
import { adminHistoryText } from "@/content/ko/admin-history";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { Button } from "@/design-system/primitives/button/button";
import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import type { AdminHistorySectionPage } from "@/features/history/contracts/admin-history-read-model";
import {
  type AdminHistoryLoadMoreContext,
  useAdminHistorySectionPage,
} from "@/features/history/controller/use-admin-history-section-page";
import { HistoryRows } from "./history-rows";
import type { AdminHistoryFailureKind } from "../contracts/admin-history-request-error";
import { HistoryReadFailure } from "./history-read-failure";
import styles from "./history-section-groups.module.css";

export type HistorySection = AdminHistorySectionPage & {
  defaultOpen?: boolean;
  title: string;
};

function HistorySectionGroup({
  compact,
  countSuffix,
  loadMoreContext,
  mutationRefreshEnabled,
  onAccessFailure,
  onCursorRejected,
  readFreshSection,
  section,
}: {
  compact: boolean;
  countSuffix: string;
  loadMoreContext?: AdminHistoryLoadMoreContext;
  mutationRefreshEnabled: boolean;
  onAccessFailure: (kind: AdminHistoryFailureKind) => void;
  onCursorRejected?: () => void;
  section: HistorySection;
  readFreshSection: HistoryFreshSectionReader;
}) {
  const { countKnown, failure, items, loadMore, loading, nextCursor, retry, totalCount } =
    useAdminHistorySectionPage({ loadMoreContext, onAccessFailure, onCursorRejected, section, readFreshSection, mutationRefreshEnabled });

  return (
    <CollapsibleStatusSection
      countLabel={countKnown ? `${totalCount}${countSuffix}` : "—"}
      defaultOpen={section.defaultOpen ?? section.groupKey === "open"}
      id={`history-${section.groupKey}`}
      title={section.title}
    >
      <div className={styles.sectionContent}>
        <HistoryRows compact={compact} items={items} />
        {loading ? <RouteLoadingState label={adminHistoryText.read.loading} variant="compact" /> : null}
        {failure ? <HistoryReadFailure failure={failure} onRetry={() => void retry()} /> : null}
        {!loading && !failure && countKnown && totalCount === 0 ? (
          <EmptyState>{adminHistoryText.read.sectionEmpty}</EmptyState>
        ) : null}
        {nextCursor && !failure ? (
          <Button
            className={styles.loadMore}
            disabled={loading}
            onClick={() => void loadMore()}
            variant="secondary"
          >
            {adminHistoryText.read.loadMore}
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
  mutationRefreshEnabled = true,
  onAccessFailure,
  onCursorRejected,
  revision = "static",
  sections,
}: {
  compact?: boolean;
  countSuffix: string;
  loadMoreContext?: AdminHistoryLoadMoreContext;
  mutationRefreshEnabled?: boolean;
  onAccessFailure?: (kind: AdminHistoryFailureKind) => void;
  onCursorRejected?: () => void;
  revision?: string;
  sections: HistorySection[];
}) {
  const [refresh] = useState(() => createHistoryRefreshCoordinator());
  useEffect(() => () => refresh.cancelAll(), [refresh]);
  const [accessFailure, setAccessFailure] = useState<{
    revision: string; kind: AdminHistoryFailureKind;
  } | null>(null);
  if (accessFailure && accessFailure.revision !== revision) setAccessFailure(null);
  const reportAccessFailure = useCallback((kind: AdminHistoryFailureKind) => {
    setAccessFailure({ revision, kind });
    onAccessFailure?.(kind);
  }, [onAccessFailure, revision]);
  if (accessFailure?.revision === revision) {
    return <HistoryReadFailure failure={accessFailure.kind} onRetry={() => {}} />;
  }
  return (
    <div className={styles.groups}>
      {sections.map((section) => (
        <HistorySectionGroup
          compact={compact}
          countSuffix={countSuffix}
          key={`${section.version ?? revision}:${section.groupKey}`}
          loadMoreContext={loadMoreContext}
          mutationRefreshEnabled={mutationRefreshEnabled}
          onAccessFailure={reportAccessFailure}
          onCursorRejected={onCursorRejected}
          readFreshSection={refresh.readFreshSection}
          section={section}
        />
      ))}
    </div>
  );
}
