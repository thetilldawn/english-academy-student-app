"use client";

import { useRouter } from "next/navigation";

import { AdminHistoryActions } from "@/components/admin-history-actions";
import { ButtonLink } from "@/components/ui-button";
import { adminHistoryText } from "@/content/ko/admin-history";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

export function HistoryDetailActions({
  item,
  mode,
}: {
  item: AssignmentHistorySummary;
  mode: "page" | "overlay";
}) {
  const router = useRouter();

  function leaveDetail() {
    if (mode === "overlay") {
      const refreshParent = () => {
        window.requestAnimationFrame(() => router.refresh());
      };
      window.addEventListener("popstate", refreshParent, { once: true });
      router.back();
      return;
    }

    window.location.replace("/admin/results");
  }

  return (
    <div className="dialog-actions history-detail-actions">
      <AdminHistoryActions
        item={item}
        onMutated={leaveDetail}
        refreshAfterMutation={false}
        showDetailLink={false}
      />
      {!item.studentDeleted ? (
        <ButtonLink href={`/admin/students?student=${item.studentId}`}>
          {adminHistoryText.detailModal.openStudent}
        </ButtonLink>
      ) : null}
    </div>
  );
}
