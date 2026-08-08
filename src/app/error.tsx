"use client";

import { useEffect } from "react";

import { getErrorReference } from "@/lib/observability/error-reference";
import { Button } from "@/components/ui-button";
import { commonText } from "@/content/ko/common";

export default function ErrorPage({
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
        event: "client.root_error_boundary",
        errorId: errorReference,
      }),
    );
  }, [errorReference]);

  return (
    <main className="auth-shell" id="main-content">
      <section className="auth-card" role="alert">
        <p className="eyebrow">{commonText.errorBoundary.eyebrow}</p>
        <h1>{commonText.errorBoundary.title}</h1>
        <p className="auth-description">
          {commonText.errorBoundary.description}
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
    </main>
  );
}
