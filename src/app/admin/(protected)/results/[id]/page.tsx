import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EditableHistoryDetailPage } from "@/features/history/ui/editable-history-detail-page";
import { getAdminHistoryReadModelDetail } from "@/features/history/server/queries/admin-history-detail-query";
import { adminHistoryText } from "@/content/ko/admin-history";
import { historyDetailHref } from "@/lib/admin/history-route";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
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
  const detail = await getAdminHistoryReadModelDetail(id);
  if (!detail) notFound();
  if (detail.canonicalKey !== id) {
    redirect(historyDetailHref(detail.summary));
  }
  const editorData = isStudentAssignmentEditable(detail.summary)
    ? await loadAssignmentManagerData({
        reuseMaterialRequestCache: false,
      })
    : null;

  return (
    <>
      <EditableHistoryDetailPage detail={detail} editorData={editorData} />
    </>
  );
}
