"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useConfirmation } from "@/design-system/patterns/confirmation/confirmation";
import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";

import { hideAdminHistoryEntry } from "../actions/hide-admin-history-entry";
import { cancelStudentAssignment } from "../api/history-mutations";
import type {
  AdminHistoryMutationReceipt,
} from "../contracts/admin-history-mutation";
import type { AdminHistoryListItem } from "../contracts/admin-history-read-model";
import { announceAdminHistoryMutation } from "../controller/admin-history-mutation-events";
import styles from "./admin-history-actions.module.css";

type ActionKey = "cancel" | "delete-history";

export function AdminHistoryActions({
  item,
  onEdit,
  onMutated,
  onViewDetail,
  showDetailLink = true,
  size = "regular",
  summaryOnly = false,
}: {
  item: AssignmentHistorySummary;
  onEdit?: (item: AssignmentHistorySummary) => void;
  onMutated?: () => void;
  onViewDetail?: () => void;
  showDetailLink?: boolean;
  size?: "regular" | "small";
  summaryOnly?: boolean;
}) {
  const scopeKey = `${item.studentId}:${item.assignmentId}:${item.attemptId}:${item.status}`;
  const [pendingAction, setPendingAction] = useState<{ scopeKey: string; action: ActionKey } | null>(null);
  const busyAction = pendingAction?.scopeKey === scopeKey ? pendingAction.action : null;
  const confirm = useConfirmation(scopeKey);
  const busyRef = useRef(false);
  const versionRef = useRef(0);
  useLayoutEffect(() => {
    versionRef.current += 1;
    busyRef.current = false;
    return () => { versionRef.current += 1; };
  }, [scopeKey]);
  const buttonSize = size === "small" ? "small" : "default";

  async function run(
    action: ActionKey,
    confirmation: string,
    request: () => Promise<{
      after: AdminHistoryListItem | null;
      receipt: AdminHistoryMutationReceipt;
    }>,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    const version = versionRef.current;
    setPendingAction({ scopeKey, action });
    try {
      if (!await confirm({ message: confirmation }) || versionRef.current !== version) return;
      const mutation = await request();
      announceAdminHistoryMutation({
        ...mutation,
        before: item,
      });
      toast.success(
        action === "cancel"
          ? adminHistoryText.actions.cancelSuccess
          : adminHistoryText.actions.deleteSuccess,
      );
      if (versionRef.current === version) onMutated?.();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminHistoryText.actions.genericError,
      );
    } finally {
      if (versionRef.current === version) {
        busyRef.current = false;
        setPendingAction(null);
      }
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
                  ).then((response) => ({
                    after: response.item,
                    receipt: response.receipt,
                  })),
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
                  ).then((receipt) => ({
                    after: null,
                    receipt,
                  })),
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
