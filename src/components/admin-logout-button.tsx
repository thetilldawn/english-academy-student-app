"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { adminShellText } from "@/content/ko/admin-shell";
import { Button } from "@/components/ui-button";

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
        setError(adminShellText.logout.error);
        return;
      }
      router.replace("/admin/login");
      router.refresh();
    } catch {
      setError(adminShellText.logout.error);
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
          ? adminShellText.logout.pending
          : adminShellText.logout.idle}
      </Button>
      {error && (
        <span className="inline-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
