"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui-button";
import { studentAppText } from "@/content/ko/student-app";

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
    <div className="action-stack">
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
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
