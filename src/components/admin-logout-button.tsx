"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { adminShellText } from "@/content/ko/admin-shell";

export function AdminLogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/session", {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("로그아웃 실패");
        return;
      }
      router.replace("/admin/login");
      router.refresh();
    } catch {
      setError("로그아웃 실패");
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
        {submitting
          ? adminShellText.logout.pending
          : adminShellText.logout.idle}
      </button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
