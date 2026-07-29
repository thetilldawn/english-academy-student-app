"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StartRetryButton({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function startRetry() {
    if (pending) return;

    setPending(true);
    setError("");

    try {
      const response = await fetch(
        `/api/student/attempts/${attemptId}/retry`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        retry?: { phase: "retry" };
        error?: string;
      };

      if (!response.ok || payload.retry?.phase !== "retry") {
        throw new Error(
          payload.error ?? "재시험을 시작하지 못했습니다.",
        );
      }

      router.replace(`/student/attempt/${attemptId}`);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "재시험을 시작하지 못했습니다.",
      );
      setPending(false);
    }
  }

  return (
    <div className="action-stack">
      <button
        aria-busy={pending}
        className="button button-primary"
        disabled={pending}
        onClick={() => void startRetry()}
        type="button"
      >
        {pending && <span aria-hidden="true" className="button-spinner" />}
        {pending ? "재시험 준비 중…" : "재시험 시작"}
      </button>
      {error && (
        <div className="inline-error quiz-error" role="alert">
          {error}
        </div>
      )}
      <span aria-live="polite" className="sr-only" role="status">
        {pending ? "재시험을 준비하고 있습니다." : ""}
      </span>
    </div>
  );
}
