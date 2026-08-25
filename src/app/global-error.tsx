"use client";

import { useEffect } from "react";

import "pretendard/dist/web/variable/pretendardvariable.css";
import "@/styles/tokens.css";
import "@/styles/theme.css";
import "@/styles/reset.css";
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
    try {
      const storedTheme = localStorage.getItem("english-academy-theme");
      const theme =
        storedTheme === "light" || storedTheme === "dark"
          ? storedTheme
          : matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {
      // The CSS color-scheme fallback still keeps the error screen readable.
    }
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
