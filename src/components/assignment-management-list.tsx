"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AssignmentSummary } from "@/lib/services/admin-service";

type ErrorResponse = {
  error?: string;
};

function statusLabel(status: AssignmentSummary["status"]) {
  if (status === "active") return "배정 중";
  if (status === "closed") return "마감";
  return "준비 중";
}

function assignmentRangeLabel(item: AssignmentSummary) {
  if (item.unitLabels.length > 0) {
    return item.unitLabels.join(", ");
  }
  return `원본 행 ${item.rangeStart.toLocaleString()}~${item.rangeEnd.toLocaleString()}`;
}

export function AssignmentManagementList({
  items,
}: {
  items: AssignmentSummary[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function deleteAssignment(item: AssignmentSummary) {
    if (
      busyId ||
      !window.confirm(
        `"${item.title}" 시험 전체를 삭제할까요?\n\n학생 화면에서는 사라지고, 이미 완료된 성적은 보존되어 내역에 '삭제됨'으로 표시됩니다. 진행 중인 응시가 있으면 삭제되지 않습니다.`,
      )
    ) {
      return;
    }

    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/assignments/${item.id}`, {
        method: "DELETE",
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as ErrorResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "시험을 삭제하지 못했습니다.");
      }
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "시험을 삭제하지 못했습니다.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <div className="empty-state">관리할 시험이 없습니다.</div>;
  }

  return (
    <div className="assignment-management-panel">
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="assignment-management-list">
        {items.map((item) => (
          <article className="card assignment-management-item" key={item.id}>
            <div className="assignment-management-copy">
              <div className="assignment-management-title">
                <strong>{item.title}</strong>
                <span className="status-pill">
                  {statusLabel(item.status)}
                </span>
              </div>
              <span>
                {item.datasetTitle} · {assignmentRangeLabel(item)}
              </span>
              <small>
                {item.questionCount}문항 · 학생 {item.studentCount}명
              </small>
            </div>
            <button
              aria-busy={busyId === item.id}
              className="button button-danger button-small"
              disabled={busyId !== null}
              onClick={() => void deleteAssignment(item)}
              type="button"
            >
              {busyId === item.id ? "삭제 중…" : "시험 전체 삭제"}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
