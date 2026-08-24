"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";

import {
  cancelStudentAssignment,
  hideAdminHistoryEntry,
} from "../api/history-mutations";
import styles from "./admin-history-actions.module.css";

type ActionKey = "cancel" | "delete-history";

export function AdminHistoryActions({
  item,
  onEdit,
  onMutated,
  onViewDetail,
  refreshAfterMutation = true,
  showDetailLink = true,
  size = "regular",
  summaryOnly = false,
}: {
  item: AssignmentHistorySummary;
  onEdit?: (item: AssignmentHistorySummary) => void;
  onMutated?: () => void;
  onViewDetail?: () => void;
  refreshAfterMutation?: boolean;
  showDetailLink?: boolean;
  size?: "regular" | "small";
  summaryOnly?: boolean;
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<ActionKey | null>(null);
  const buttonSize = size === "small" ? "small" : "default";

  async function run(
    action: ActionKey,
    confirmation: string,
    request: () => Promise<void>,
  ) {
    if (busyAction || !window.confirm(confirmation)) return;
    setBusyAction(action);
    try {
      await request();
      toast.success(
        action === "cancel"
          ? adminHistoryText.actions.cancelSuccess
          : adminHistoryText.actions.deleteSuccess,
      );
      onMutated?.();
      if (refreshAfterMutation) router.refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminHistoryText.actions.genericError,
      );
    } finally {
      setBusyAction(null);
    }
  }

  if (summaryOnly) {
    return (
      <div className={styles.stack}>
        <div className={styles.group}>
          {onViewDetail ? (
            <Button onClick={onViewDetail} size={buttonSize}>
              {adminHistoryText.actions.view}
            </Button>
          ) : showDetailLink ? (
            <ButtonLink href={historyDetailHref(item)} size={buttonSize}>
              {adminHistoryText.actions.view}
            </ButtonLink>
          ) : onEdit && isStudentAssignmentEditable(item) ? (
            <Button
              aria-label={formatContentText(
                adminHistoryText.actions.editAria,
                { student: item.studentName, title: item.assignmentTitle },
              )}
              onClick={() => onEdit(item)}
              size={buttonSize}
            >
              {adminHistoryText.actions.edit}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.group}>
        {showDetailLink
          ? onViewDetail
            ? (
                <Button onClick={onViewDetail} size={buttonSize}>
                  {adminHistoryText.actions.viewHistory}
                </Button>
              )
            : (
                <ButtonLink href={historyDetailHref(item)} size={buttonSize}>
                  {adminHistoryText.actions.viewHistory}
                </ButtonLink>
              )
          : null}
        {onEdit && isStudentAssignmentEditable(item) ? (
          <Button
            aria-label={formatContentText(
              adminHistoryText.actions.editAria,
              { student: item.studentName, title: item.assignmentTitle },
            )}
            disabled={busyAction !== null}
            onClick={() => onEdit(item)}
            size={buttonSize}
          >
            {adminHistoryText.actions.edit}
          </Button>
        ) : null}
        {item.status === "not_started" &&
        !item.attemptId &&
        !item.assignmentDeleted ? (
          <Button
            aria-busy={busyAction === "cancel"}
            disabled={busyAction !== null}
            onClick={() =>
              void run(
                "cancel",
                formatContentText(adminHistoryText.actions.cancel.confirm, {
                  student: item.studentName,
                }),
                () =>
                  cancelStudentAssignment(
                    item.assignmentId,
                    item.studentId,
                    adminHistoryText.actions.genericError,
                  ),
              )
            }
            size={buttonSize}
          >
            {busyAction === "cancel"
              ? adminHistoryText.actions.cancel.pending
              : adminHistoryText.actions.cancel.action}
          </Button>
        ) : null}
        {(["cancelled", "missed", "completed", "expired"] as const).includes(
          item.status as "cancelled" | "missed" | "completed" | "expired",
        ) ? (
          <Button
            aria-busy={busyAction === "delete-history"}
            disabled={busyAction !== null}
            onClick={() =>
              void run(
                "delete-history",
                adminHistoryText.actions.delete.confirm,
                () =>
                  hideAdminHistoryEntry(
                    {
                      assignmentId: item.assignmentId,
                      studentId: item.studentId,
                      attemptId: item.attemptId,
                    },
                    adminHistoryText.actions.genericError,
                  ),
              )
            }
            size={buttonSize}
            variant="quiet"
          >
            {busyAction === "delete-history"
              ? adminHistoryText.actions.delete.pending
              : adminHistoryText.actions.delete.action}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
