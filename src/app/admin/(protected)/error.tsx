"use client";

import { useEffect } from "react";

import { getErrorReference } from "@/lib/observability/error-reference";
import { Button } from "@/design-system/primitives/button/button";
import { commonText } from "@/content/ko/common";
import { adminShellText } from "@/content/ko/admin-shell";
import styles from "./route-state.module.css";

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
    <section className={styles.error} role="alert">
      <p className={styles.eyebrow}>{commonText.errorBoundary.eyebrow}</p>
      <h2>{commonText.errorBoundary.title}</h2>
      <p>
        {adminShellText.errorBoundary.safeDescription}
      </p>
      {errorReference ? (
        <p className={styles.reference}>
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
