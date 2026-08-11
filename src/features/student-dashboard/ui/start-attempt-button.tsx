"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { studentAppText } from "@/content/ko/student-app";
import { Button } from "@/design-system/primitives/button/button";

import { requestStudentAttempt } from "../api/start-attempt";
import styles from "./start-attempt-button.module.css";

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
      const { ok, payload } = await requestStudentAttempt(assignmentId);
      if (!ok || !payload.attemptId) {
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
    <div className={styles.stack}>
      <Button
        disabled={disabled || submitting}
        onClick={start}
        variant="primary"
      >
        {submitting
          ? studentAppText.actions.startPending
          : studentAppText.actions.start}
      </Button>
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
