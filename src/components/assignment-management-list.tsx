"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  MetaTag,
  MetaTagList,
  StatusBadge,
} from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { assignmentDisplayTitle } from "@/lib/admin/history";
import type { AssignmentSummary } from "@/lib/services/admin-service";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";

import styles from "./assignment-management-list.module.css";

type ErrorResponse = {
  error?: string;
};

function statusLabel(status: AssignmentSummary["status"]) {
  if (status === "active") {
    return adminLearningText.assignmentManagement.status.active;
  }
  if (status === "closed") {
    return adminLearningText.assignmentManagement.status.closed;
  }
  return adminLearningText.assignmentManagement.status.draft;
}

function assignmentRangeLabel(item: AssignmentSummary) {
  if (item.unitLabels.length > 0) {
    return item.unitLabels.join(", ");
  }
  return formatContentText(
    adminLearningText.assignmentManagement.originalRows,
    {
      start: item.rangeStart.toLocaleString(),
      end: item.rangeEnd.toLocaleString(),
    },
  );
}

export function AssignmentManagementList({
  items,
}: {
  items: AssignmentSummary[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function deleteAssignment(item: AssignmentSummary) {
    if (
      busyId ||
      !window.confirm(formatContentText(
        adminLearningText.assignmentManagement.delete.confirm,
        { title: item.title },
      ))
    ) {
      return;
    }

    setBusyId(item.id);
    try {
      const response = await fetch(`/api/admin/assignments/${item.id}`, {
        method: "DELETE",
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as ErrorResponse;
      if (!response.ok) {
        throw new Error(
          payload.error ?? adminLearningText.assignmentManagement.delete.error,
        );
      }
      toast.success(adminLearningText.assignmentManagement.delete.success);
      router.refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminLearningText.assignmentManagement.delete.error,
      );
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <EmptyState>{adminLearningText.assignmentManagement.empty}</EmptyState>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.list}>
        {items.map((item) => (
          <article className={styles.item} key={item.id}>
            <div className={styles.copy}>
              <div className={styles.title}>
                {assignmentDisplayTitle({
                  assignmentTitle: item.title,
                  datasetTitle: item.datasetTitle,
                  primaryUnitLabels: item.unitLabels,
                  unitLabels: item.unitLabels,
                }) ? (
                  <strong>{assignmentDisplayTitle({
                    assignmentTitle: item.title,
                    datasetTitle: item.datasetTitle,
                    primaryUnitLabels: item.unitLabels,
                    unitLabels: item.unitLabels,
                  })}</strong>
                ) : null}
                <StatusBadge
                  tone={item.status === "active" ? "warning" : "neutral"}
                >
                  {statusLabel(item.status)}
                </StatusBadge>
              </div>
              <MetaTagList>
                <MetaTag>{item.datasetTitle}</MetaTag>
                <MetaTag>{assignmentRangeLabel(item)}</MetaTag>
                <MetaTag>
                  {formatContentText(
                    adminLearningText.assignmentManagement.questionCount,
                    { count: item.questionCount },
                  )}
                </MetaTag>
                <MetaTag>
                  {formatContentText(
                    adminLearningText.assignmentManagement.studentCount,
                    { count: item.studentCount },
                  )}
                </MetaTag>
              </MetaTagList>
            </div>
            <Button
              aria-busy={busyId === item.id}
              disabled={busyId !== null}
              onClick={() => void deleteAssignment(item)}
              size="small"
              variant="danger"
            >
              {busyId === item.id
                ? adminLearningText.assignmentManagement.delete.pending
                : adminLearningText.assignmentManagement.delete.action}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
