"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { adminShellText } from "@/content/ko/admin-shell";
import { Button } from "@/design-system/primitives/button/button";
import { InlineError } from "@/design-system/patterns/feedback/feedback";
import { requestAdminLogout } from "@/features/session/api/session";

import styles from "./session-action.module.css";

export function AdminLogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setError("");
    setSubmitting(true);
    try {
      const ok = await requestAdminLogout();
      if (!ok) {
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
    <div className={styles.stack}>
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
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
