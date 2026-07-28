"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
        setError("접속 종료 실패");
        return;
      }
      router.replace("/code");
      router.refresh();
    } catch {
      setError("접속 종료 실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="action-stack">
      <button
        className="button button-quiet button-small"
        disabled={submitting}
        onClick={logout}
        type="button"
      >
        {submitting ? "종료 중…" : "접속 종료"}
      </button>
      {error && <span className="inline-error">{error}</span>}
    </div>
  );
}
