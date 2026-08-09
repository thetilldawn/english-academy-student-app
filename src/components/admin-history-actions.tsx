"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, ButtonLink } from "@/components/ui-button";
import { formatContentText } from "@/content/format";
import { adminHistoryText } from "@/content/ko/admin-history";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";

type ActionKey = "cancel" | "delete-history";

type ErrorResponse = {
  error?: string;
};

async function mutate(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  let payload: ErrorResponse = {};
  try {
    payload = (await response.json()) as ErrorResponse;
  } catch {
    // 비정상 응답도 사용자가 다시 시도할 수 있는 공통 오류로 처리한다.
  }
  if (!response.ok) {
    throw new Error(payload.error ?? adminHistoryText.actions.genericError);
  }
}

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
    url: string,
    options: RequestInit,
  ) {
    if (busyAction || !window.confirm(confirmation)) {
      return;
    }
    setBusyAction(action);
    try {
      await mutate(url, options);
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
      <div className="history-action-stack">
        <div className="history-action-group">
          {onViewDetail ? (
            <Button
              onClick={onViewDetail}
              size={buttonSize}
            >
              {adminHistoryText.actions.view}
            </Button>
          ) : showDetailLink ? (
            <ButtonLink
              href={historyDetailHref(item)}
              size={buttonSize}
            >
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
    <div className="history-action-stack">
      <div className="history-action-group">
        {showDetailLink
          ? onViewDetail
            ? (
                <Button
                  onClick={onViewDetail}
                  size={buttonSize}
                >
                  {adminHistoryText.actions.viewHistory}
                </Button>
              )
            : (
                <ButtonLink
                  href={historyDetailHref(item)}
                  size={buttonSize}
                >
                  {adminHistoryText.actions.viewHistory}
                </ButtonLink>
              )
          : null}
        {onEdit && isStudentAssignmentEditable(item) && (
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
        )}
        {item.status === "not_started" &&
          !item.attemptId &&
          !item.assignmentDeleted && (
            <Button
              aria-busy={busyAction === "cancel"}
              disabled={busyAction !== null}
              onClick={() =>
                void run(
                  "cancel",
                  formatContentText(
                    adminHistoryText.actions.cancel.confirm,
                    { student: item.studentName },
                  ),
                  `/api/admin/assignments/${item.assignmentId}/students/${item.studentId}`,
                  { method: "DELETE" },
                )
              }
              size={buttonSize}
            >
              {busyAction === "cancel"
                ? adminHistoryText.actions.cancel.pending
                : adminHistoryText.actions.cancel.action}
            </Button>
          )}
        {(["cancelled", "missed", "completed", "expired"] as const).includes(
          item.status as "cancelled" | "missed" | "completed" | "expired",
        ) && (
          <Button
            aria-busy={busyAction === "delete-history"}
            disabled={busyAction !== null}
            onClick={() =>
              void run(
                "delete-history",
                adminHistoryText.actions.delete.confirm,
                "/api/admin/history",
                {
                  method: "DELETE",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    assignmentId: item.assignmentId,
                    studentId: item.studentId,
                    attemptId: item.attemptId,
                  }),
                },
              )
            }
            size={buttonSize}
            variant="quiet"
          >
            {busyAction === "delete-history"
              ? adminHistoryText.actions.delete.pending
              : adminHistoryText.actions.delete.action}
          </Button>
        )}
      </div>
    </div>
  );
}
