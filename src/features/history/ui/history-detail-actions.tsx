"use client";

import { useMemo, type Ref } from "react";
import { useRouter } from "next/navigation";

import { adminHistoryText } from "@/content/ko/admin-history";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import { AdminHistoryActions } from "./admin-history-actions";
import { buildHistoryAssignmentEditorModel } from "./history-assignment-editor-model";
import styles from "./history-detail-actions.module.css";

export function HistoryDetailActions({
  editorData,
  editButtonRef,
  item,
  mode,
  onEditRequested,
}: {
  editorData: AssignmentManagerData | null;
  editButtonRef?: Ref<HTMLButtonElement>;
  item: AssignmentHistorySummary;
  mode: "page" | "overlay";
  onEditRequested: () => void;
}) {
  const router = useRouter();
  const editorModel = useMemo(
    () => buildHistoryAssignmentEditorModel(editorData, item),
    [editorData, item],
  );

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
    <div className={styles.actions}>
      {editorModel && isStudentAssignmentEditable(item) ? (
        <Button
          ref={editButtonRef}
          onClick={onEditRequested}
        >
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
