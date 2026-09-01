"use client";

import { adminLearningText } from "@/content/ko/admin-learning";

import { AdminRouteError } from "../admin-route-error";

export default function AssignmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AdminRouteError
      description={adminLearningText.page.errorDescription}
      error={error}
      event="client.assignment_workspace_error_boundary"
      reset={reset}
      title={adminLearningText.page.errorTitle}
    />
  );
}
