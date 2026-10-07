"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { studentAppText } from "@/content/ko/student-app";
import { Button } from "@/design-system/primitives/button/button";

import { LocalQuizLoadingDialog, prepareLocalQuiz, prefetchLocalQuiz } from "@/features/quiz-player/public-local-client";
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
  const prefetch = useRef<AbortController | null>(null);
  const preparation = useRef<AbortController | null>(null);
  const cancelPrefetch = () => { prefetch.current?.abort(); prefetch.current = null; };
  useEffect(() => () => { prefetch.current?.abort(); preparation.current?.abort(); }, [assignmentId]);
  function cancelPreparation() {
    preparation.current?.abort();
    preparation.current = null;
    setSubmitting(false);
  }
  function warm() {
    if (disabled || submitting || prefetch.current) return;
    const controller = new AbortController(); prefetch.current = controller;
    void prefetchLocalQuiz(assignmentId, controller.signal).catch(() => {}).finally(() => {
      if (prefetch.current === controller) prefetch.current = null;
    });
  }

  async function start() {
    if (preparation.current) return;
    const controller = new AbortController();
    preparation.current = controller;
    setError("");
    setSubmitting(true);
    try {
      const operation = prepareLocalQuiz(assignmentId, controller.signal);
      cancelPrefetch();
      const href = await operation;
      if (!controller.signal.aborted) router.push(href);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error && /[가-힣]/.test(failure.message) ? failure.message : studentAppText.actions.networkError);
    } finally {
      if (preparation.current === controller) { preparation.current = null; setSubmitting(false); }
    }
  }

  return (
    <div className={styles.stack}>
      {submitting ? <LocalQuizLoadingDialog onCancel={cancelPreparation} /> : null}
      <Button
        disabled={disabled || submitting}
        onClick={start}
        onMouseEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) cancelPrefetch(); }}
        onBlur={event => { if (!event.currentTarget.matches(":hover")) cancelPrefetch(); }}
        onTouchCancel={cancelPrefetch}
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
