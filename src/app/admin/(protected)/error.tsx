"use client";

import { useEffect } from "react";

import { getErrorReference } from "@/lib/observability/error-reference";
import { Button } from "@/design-system/primitives/button/button";
import { commonText } from "@/content/ko/common";
import { adminShellText } from "@/content/ko/admin-shell";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const errorReference = getErrorReference(error);

  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "client.admin_error_boundary",
        errorId: errorReference,
      }),
    );
  }, [errorReference]);

  return (
    <section className="card admin-error-state" role="alert">
      <p className="eyebrow">{commonText.errorBoundary.eyebrow}</p>
      <h1>{commonText.errorBoundary.title}</h1>
      <p>
        {adminShellText.errorBoundary.safeDescription}
      </p>
      {errorReference ? (
        <p className="error-reference">
          {commonText.errorBoundary.referenceLabel}{" "}
          <code>{errorReference}</code>
        </p>
      ) : null}
      <Button onClick={reset} variant="primary">
        {commonText.errorBoundary.retry}
      </Button>
    </section>
  );
}
