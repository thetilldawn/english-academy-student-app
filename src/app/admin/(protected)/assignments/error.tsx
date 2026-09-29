"use client";

import { adminLearningText } from "@/content/ko/admin-learning";

import { AdminRouteError } from "../admin-route-error";

export default function AssignmentsError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  return (
    <AdminRouteError
      description={adminLearningText.page.errorDescription}
      error={error}
      event="client.assignment_workspace_error_boundary"
      reset={reset}
      unstable_retry={unstable_retry}
      title={adminLearningText.page.errorTitle}
    />
  );
}
