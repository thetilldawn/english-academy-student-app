import { notFound, redirect } from "next/navigation";

import { EditableHistoryDetailDialog } from "@/features/history/ui/editable-history-detail-dialog";
import { historyDetailHref } from "@/lib/admin/history-route";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import { getAdminHistoryReadModelDetail } from "@/features/history/server/queries/admin-history-detail-query";
import { loadAssignmentManagerData } from "@/lib/services/assignment-manager-data";

export default async function InterceptedAdminResultDetailPage({
  params,
}: {
  params: Promise<{ entryKey: string }>;
}) {
  const { entryKey } = await params;
  const detail = await getAdminHistoryReadModelDetail(entryKey);
  if (!detail) notFound();
  if (detail.canonicalKey !== entryKey) {
    redirect(historyDetailHref(detail.summary));
  }
  const editorData = isStudentAssignmentEditable(detail.summary)
    ? await loadAssignmentManagerData({
        reuseMaterialRequestCache: false,
      })
    : null;

  return <EditableHistoryDetailDialog detail={detail} editorData={editorData} />;
}
