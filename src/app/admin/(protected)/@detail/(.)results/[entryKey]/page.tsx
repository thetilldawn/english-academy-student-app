import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { EditableHistoryDetailDialog } from "@/features/history/ui/editable-history-detail-dialog";
import { adminShellText } from "@/content/ko/admin-shell";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { historyDetailHref } from "@/lib/admin/history-route";
import { getAdminHistoryReadModelDetail } from "@/features/history/server/queries/admin-history-detail-query";

export default function InterceptedAdminResultDetailPage({
  params,
}: {
  params: Promise<{ entryKey: string }>;
}) {
  return (
    <Suspense fallback={<RouteLoadingState label={adminShellText.loading} />}>
      <InterceptedAdminResultDetailContent params={params} />
    </Suspense>
  );
}

async function InterceptedAdminResultDetailContent({
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
  return <EditableHistoryDetailDialog detail={detail} />;
}
