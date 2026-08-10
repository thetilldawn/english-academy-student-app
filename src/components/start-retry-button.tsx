"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  ButtonSpinner,
} from "@/design-system/primitives/button/button";
import { studentAppText } from "@/content/ko/student-app";

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
          payload.error ?? studentAppText.actions.retryError,
        );
      }

      router.replace(`/student/attempt/${attemptId}`);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : studentAppText.actions.retryError,
      );
      setPending(false);
    }
  }

  return (
    <div className="action-stack">
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={() => void startRetry()}
        variant="primary"
      >
        {pending && <ButtonSpinner />}
        {pending
          ? studentAppText.actions.retryPending
          : studentAppText.actions.retry}
      </Button>
      {error && (
        <div className="inline-error quiz-error" role="alert">
          {error}
        </div>
      )}
      <span aria-live="polite" className="sr-only" role="status">
        {pending ? studentAppText.actions.retryPreparing : ""}
      </span>
    </div>
  );
}
