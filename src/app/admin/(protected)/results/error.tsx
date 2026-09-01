"use client";

import { adminHistoryText } from "@/content/ko/admin-history";

import { AdminRouteError } from "../admin-route-error";

export default function ResultsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AdminRouteError
      description={adminHistoryText.page.errorDescription}
      error={error}
      event="client.admin_history_error_boundary"
      reset={reset}
      title={adminHistoryText.page.errorTitle}
    />
  );
}
