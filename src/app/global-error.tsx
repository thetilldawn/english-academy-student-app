"use client";

import { useEffect } from "react";

import { getErrorReference } from "@/lib/observability/error-reference";
import { commonText } from "@/content/ko/common";
import { Button } from "@/components/ui-button";

export default function GlobalError({
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
        event: "client.global_error_boundary",
        errorId: errorReference,
      }),
    );
  }, [errorReference]);

  return (
    <html lang="ko">
      <body>
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
      </body>
    </html>
  );
}
