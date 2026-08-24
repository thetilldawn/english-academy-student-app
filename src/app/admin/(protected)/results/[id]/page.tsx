import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EditableHistoryDetailPage } from "@/features/history/ui/editable-history-detail-page";
import { adminHistoryText } from "@/content/ko/admin-history";
import { historyDetailHref } from "@/lib/admin/history-route";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import { getAdminHistoryDetail } from "@/lib/services/admin-history-read-service";
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
    <>
      <EditableHistoryDetailPage detail={detail} editorData={editorData} />
    </>
  );
}
