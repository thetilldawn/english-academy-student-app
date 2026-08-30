import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EditableHistoryDetailPage } from "@/features/history/ui/editable-history-detail-page";
import { getAdminHistoryReadModelDetail } from "@/features/history/server/queries/admin-history-detail-query";
import { adminHistoryText } from "@/content/ko/admin-history";
import { historyDetailHref } from "@/lib/admin/history-route";

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
  return <EditableHistoryDetailPage detail={detail} />;
}
