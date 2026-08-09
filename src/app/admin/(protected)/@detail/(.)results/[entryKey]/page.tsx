import { notFound, redirect } from "next/navigation";

import {
  AdminHistoryDetailContent,
  AdminHistoryDetailHeading,
} from "@/components/admin-history-detail";
import { HistoryDetailActions } from "@/components/history-detail-actions";
import { RouteDetailDialog } from "@/components/route-detail-dialog";
import { historyDetailHref } from "@/lib/admin/history-route";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import { getAdminHistoryDetail } from "@/lib/services/admin-service";
import { loadAssignmentManagerData } from "@/lib/services/assignment-manager-data";

export default async function InterceptedAdminResultDetailPage({
  params,
}: {
  params: Promise<{ entryKey: string }>;
}) {
  const { entryKey } = await params;
  const detail = await getAdminHistoryDetail(entryKey);
  if (!detail) notFound();
  if (detail.canonicalKey !== entryKey) {
    redirect(historyDetailHref(detail.summary));
  }
  const editorData = isStudentAssignmentEditable(detail.summary)
    ? await loadAssignmentManagerData()
    : null;

  return (
    <RouteDetailDialog
      heading={
        <AdminHistoryDetailHeading
          detail={detail}
          titleId="route-history-detail-title"
        />
      }
    >
      <AdminHistoryDetailContent
        actions={
          <HistoryDetailActions
            editorData={editorData}
            item={detail.summary}
            mode="overlay"
          />
        }
        detail={detail}
      />
    </RouteDetailDialog>
  );
}
