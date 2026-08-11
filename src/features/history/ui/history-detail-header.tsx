import type { ReactNode } from "react";

import { DetailHeader } from "@/design-system/patterns/detail-header/detail-header";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";
import { assignmentDisplayTitle } from "@/lib/admin/history";
import { formatKoreanDateTime } from "@/lib/format";
import type { AdminHistoryDetail } from "@/lib/services/admin-service";

import { AssignmentMetaTags } from "./assignment-meta-tags";
import styles from "./history-detail-header.module.css";

export function HistoryDetailHeader({
  detail,
  titleId,
}: {
  detail: AdminHistoryDetail;
  titleId: string;
}) {
  const { attempt, summary } = detail;
  const displayTitle = assignmentDisplayTitle(summary);

  return (
    <DetailHeader
      metadata={
        <>
          <AssignmentMetaTags {...summary} compact />
          <MetaTagList>
            {attempt ? (
              <MetaTag>
                {formatContentText(adminHistoryText.resultDetail.attemptNumber, {
                  count: attempt.attemptNumber,
                })}
              </MetaTag>
            ) : null}
            {attempt?.startedAt ? (
              <MetaTag>{formatKoreanDateTime(attempt.startedAt)}</MetaTag>
            ) : null}
          </MetaTagList>
        </>
      }
      subtitle={displayTitle || undefined}
      title={summary.studentName}
      titleId={titleId}
    />
  );
}

export function HistoryDetailPageHeader({
  actions,
  detail,
  titleId,
}: {
  actions: ReactNode;
  detail: AdminHistoryDetail;
  titleId: string;
}) {
  return (
    <header className={styles.pageHeader}>
      <HistoryDetailHeader detail={detail} titleId={titleId} />
      {actions}
    </header>
  );
}
