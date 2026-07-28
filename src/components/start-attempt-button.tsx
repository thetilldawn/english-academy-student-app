"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StartResponse = {
  attemptId?: string;
  error?: string;
};

export function StartAttemptButton({
  assignmentId,
  disabled = false,
}: {
  assignmentId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function start() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/student/assignments/${assignmentId}/attempts`,
        { method: "POST" },
      );
      const payload = (await response.json()) as StartResponse;

      if (!response.ok || !payload.attemptId) {
        setError(payload.error ?? "시험을 시작할 수 없습니다.");
        return;
      }

      router.push(`/student/attempt/${payload.attemptId}`);
    } catch {
      setError("연결을 확인한 뒤 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="action-stack">
      <button
        className="button button-primary"
        disabled={disabled || submitting}
        onClick={start}
        type="button"
      >
        {submitting ? "시험 준비 중…" : "시험 시작"}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
