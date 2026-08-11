"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/design-system/primitives/button/button";
import { InlineError } from "@/design-system/patterns/feedback/feedback";
import { studentAppText } from "@/content/ko/student-app";

import styles from "./session-action.module.css";

export function StudentLogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/student/session", {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(studentAppText.shell.logoutError);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(studentAppText.shell.logoutError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.stack}>
      <Button
        disabled={submitting}
        onClick={logout}
        size="small"
        variant="quiet"
      >
        {submitting
          ? studentAppText.shell.logoutPending
          : studentAppText.shell.logout}
      </Button>
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
