"use client";

import { useEffect } from "react";

import { getErrorReference } from "@/lib/observability/error-reference";
import { commonText } from "@/content/ko/common";
import { Button } from "@/design-system/primitives/button/button";
import styles from "@/design-system/patterns/auth/auth-layout.module.css";

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
        <main className={styles.authShell} id="main-content">
          <section className={styles.authCard} role="alert">
            <p className={styles.eyebrow}>{commonText.errorBoundary.eyebrow}</p>
            <h1>{commonText.errorBoundary.title}</h1>
            <p className={styles.description}>
              {commonText.errorBoundary.description}
            </p>
            {errorReference ? (
              <p className={styles.errorReference}>
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
