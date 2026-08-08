"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui-button";
import { studentAppText } from "@/content/ko/student-app";

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
        setError(payload.error ?? studentAppText.actions.startError);
        return;
      }

      router.push(`/student/attempt/${payload.attemptId}`);
    } catch {
      setError(studentAppText.actions.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="action-stack">
      <Button
        disabled={disabled || submitting}
        onClick={start}
        variant="primary"
      >
        {submitting
          ? studentAppText.actions.startPending
          : studentAppText.actions.start}
      </Button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
