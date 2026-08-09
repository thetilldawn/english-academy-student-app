"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminHistoryActions } from "@/components/admin-history-actions";
import { AssignmentManager } from "@/components/assignment-manager";
import { Button, ButtonLink } from "@/components/ui-button";
import { adminHistoryText } from "@/content/ko/admin-history";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

export function HistoryDetailActions({
  editorData,
  item,
  mode,
}: {
  editorData: AssignmentManagerData | null;
  item: AssignmentHistorySummary;
  mode: "page" | "overlay";
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

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

  if (editing && editorData) {
    return (
      <section
        aria-labelledby="history-detail-editor-title"
        className="history-detail-editor"
      >
        <div className="section-heading history-detail-editor-heading">
          <h2 id="history-detail-editor-title">
            {adminHistoryText.actions.edit}
          </h2>
          <Button onClick={() => setEditing(false)} size="small" variant="quiet">
            {adminHistoryText.detailModal.close}
          </Button>
        </div>
        <AssignmentManager
          {...editorData}
          embedded
          initialDatasetId={item.datasetId}
          initialDialogView="assign"
          initialEditTarget={{
            assignmentId: item.assignmentId,
            studentId: item.studentId,
          }}
          initialStudentId={item.studentId}
          launcherOnly
          onAssignmentReplaced={(result) => {
            setEditing(false);
            router.replace(
              historyDetailHref({
                assignmentId: result.replacementAssignmentId,
                attemptId: null,
                studentId: result.studentId,
              }),
              { scroll: false },
            );
            router.refresh();
          }}
          onLauncherClose={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <div className="dialog-actions history-detail-actions">
      {editorData && isStudentAssignmentEditable(item) ? (
        <Button onClick={() => setEditing(true)}>
          {adminHistoryText.actions.edit}
        </Button>
      ) : null}
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
