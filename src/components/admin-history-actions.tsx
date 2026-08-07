"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AssignmentHistorySummary } from "@/lib/admin/history";

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
    throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
  }
}

export function AdminHistoryActions({
  item,
  onMutated,
  onViewDetail,
  showDetailLink = true,
  size = "regular",
}: {
  item: AssignmentHistorySummary;
  onMutated?: () => void;
  onViewDetail?: () => void;
  showDetailLink?: boolean;
  size?: "regular" | "small";
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<ActionKey | null>(null);
  const [error, setError] = useState("");
  const sizeClass = size === "small" ? " button-small" : "";

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
    setError("");
    try {
      await mutate(url, options);
      onMutated?.();
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "요청을 처리하지 못했습니다.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="history-action-stack">
      <div className="history-action-group">
        {showDetailLink && item.attemptId
          ? onViewDetail
            ? (
                <button
                  className={`button button-secondary${sizeClass}`}
                  onClick={onViewDetail}
                  type="button"
                >
                  내역 보기
                </button>
              )
            : (
                <Link
                  className={`button button-secondary${sizeClass}`}
                  href={`/admin/results/${item.attemptId}`}
                >
                  내역 보기
                </Link>
              )
          : null}
        {item.status === "not_started" &&
          !item.attemptId &&
          !item.assignmentDeleted && (
            <button
              aria-busy={busyAction === "cancel"}
              className={`button button-secondary${sizeClass}`}
              disabled={busyAction !== null}
              onClick={() =>
                void run(
                  "cancel",
                  `${item.studentName} 학생의 이 배정만 취소할까요? 틀렸던 단어는 다음 시험 대기에 유지됩니다.`,
                  `/api/admin/assignments/${item.assignmentId}/students/${item.studentId}`,
                  { method: "DELETE" },
                )
              }
              type="button"
            >
              {busyAction === "cancel" ? "취소 중…" : "배정 취소"}
            </button>
          )}
        {(["cancelled", "missed", "completed", "expired"] as const).includes(
          item.status as "cancelled" | "missed" | "completed" | "expired",
        ) && (
          <button
            aria-busy={busyAction === "delete-history"}
            className={`button button-quiet${sizeClass}`}
            disabled={busyAction !== null}
            onClick={() =>
              void run(
                "delete-history",
                "이 항목만 내역 목록에서 삭제할까요? 시험 결과와 오답 기록 원본은 안전하게 보존됩니다.",
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
            type="button"
          >
            {busyAction === "delete-history"
              ? "삭제 중…"
              : "내역 삭제"}
          </button>
        )}
      </div>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
