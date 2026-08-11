"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { studentAppText } from "@/content/ko/student-app";
import {
  Button,
  ButtonSpinner,
} from "@/design-system/primitives/button/button";

import { requestAttemptRetry } from "../api/start-retry";
import styles from "./start-retry-button.module.css";

export function StartRetryButton({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function startRetry() {
    if (pending) return;
    setPending(true);
    setError("");

    try {
      await requestAttemptRetry(attemptId);
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
    <div className={styles.stack}>
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={() => void startRetry()}
        variant="primary"
      >
        {pending ? <ButtonSpinner /> : null}
        {pending
          ? studentAppText.actions.retryPending
          : studentAppText.actions.retry}
      </Button>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <span aria-live="polite" className="sr-only" role="status">
        {pending ? studentAppText.actions.retryPreparing : ""}
      </span>
    </div>
  );
}
