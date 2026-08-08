"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { Button } from "@/components/ui-button";
import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { assignmentDisplayTitle } from "@/lib/admin/history";
import type { AssignmentSummary } from "@/lib/services/admin-service";

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
    return (
      <div className="empty-state">
        {adminLearningText.assignmentManagement.empty}
      </div>
    );
  }

  return (
    <div className="assignment-management-panel">
      <div className="assignment-management-list">
        {items.map((item) => (
          <article className="card assignment-management-item" key={item.id}>
            <div className="assignment-management-copy">
              <div className="assignment-management-title">
                <strong>
                  {assignmentDisplayTitle({
                    assignmentTitle: item.title,
                    primaryUnitLabels: item.unitLabels,
                    unitLabels: item.unitLabels,
                  })}
                </strong>
                <MetaTag
                  tone={item.status === "active" ? "warning" : "neutral"}
                >
                  {statusLabel(item.status)}
                </MetaTag>
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
