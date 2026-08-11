import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  AdminHistoryDetailContent,
} from "@/components/admin-history-detail";
import { HistoryDetailActions } from "@/components/history-detail-actions";
import { ButtonLink } from "@/design-system/primitives/button/button";
import { HistoryDetailPageHeader } from "@/features/history/ui/history-detail-header";
import { adminHistoryText } from "@/content/ko/admin-history";
import { historyDetailHref } from "@/lib/admin/history-route";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import { getAdminHistoryDetail } from "@/lib/services/admin-service";
import { loadAssignmentManagerData } from "@/lib/services/assignment-manager-data";

export const metadata: Metadata = {
  title: adminHistoryText.resultDetail.metadataTitle,
};

export default async function AdminResultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAdminHistoryDetail(id);
  if (!detail) notFound();
  if (detail.canonicalKey !== id) {
    redirect(historyDetailHref(detail.summary));
  }
  const editorData = isStudentAssignmentEditable(detail.summary)
    ? await loadAssignmentManagerData()
    : null;

  return (
    <div className="history-detail-page">
      <HistoryDetailPageHeader
        actions={
          <ButtonLink href="/admin/results" variant="quiet">
            {adminHistoryText.resultDetail.backToResults}
          </ButtonLink>
        }
        detail={detail}
        titleId="history-detail-page-title"
      />
      <AdminHistoryDetailContent
        actions={
          <HistoryDetailActions
            editorData={editorData}
            item={detail.summary}
            mode="page"
          />
        }
        detail={detail}
      />
    </div>
  );
}
