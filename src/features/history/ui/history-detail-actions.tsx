"use client";

import type { Ref } from "react";
import { useRouter } from "next/navigation";

import { adminHistoryText } from "@/content/ko/admin-history";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { AdminHistoryActions } from "./admin-history-actions";
import styles from "./history-detail-actions.module.css";

export function HistoryDetailActions({
  editButtonRef,
  item,
  mode,
  onEditRequested,
}: {
  editButtonRef?: Ref<HTMLButtonElement>;
  item: AssignmentHistorySummary;
  mode: "page" | "overlay";
  onEditRequested: () => void;
}) {
  const router = useRouter();
  function leaveDetail() {
    if (mode === "overlay") {
      router.back();
      return;
    }
    router.replace("/admin/results");
  }

  return (
    <div className={styles.actions}>
      {isStudentAssignmentEditable(item) ? (
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
        showDetailLink={false}
      />
      {!item.studentDeleted ? (
        <ButtonLink
          href={`/admin/students/${item.studentId}`}
          prefetch={false}
        >
          {adminHistoryText.detailModal.openStudent}
        </ButtonLink>
      ) : null}
    </div>
  );
}
