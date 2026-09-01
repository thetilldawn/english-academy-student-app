"use client";

import { useEffect } from "react";

import { adminShellText } from "@/content/ko/admin-shell";
import { commonText } from "@/content/ko/common";
import { Button } from "@/design-system/primitives/button/button";
import { getErrorReference } from "@/lib/observability/error-reference";

import styles from "./route-state.module.css";

export type AdminRouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  event?: string;
  title?: string;
  description?: string;
};

export function AdminRouteError({
  error,
  reset,
  event = "client.admin_error_boundary",
  title = commonText.errorBoundary.title,
  description = adminShellText.errorBoundary.safeDescription,
}: AdminRouteErrorProps) {
  const errorReference = getErrorReference(error);

  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        event,
        errorId: errorReference,
      }),
    );
  }, [errorReference, event]);

  return (
    <section className={styles.error} role="alert">
      <p className={styles.eyebrow}>{commonText.errorBoundary.eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
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
