"use client";

import { useEffect } from "react";

import { getErrorReference } from "@/lib/observability/error-reference";

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
            <p className="eyebrow">오류</p>
            <h1>화면을 불러오지 못했습니다</h1>
            <p className="auth-description">
              잠시 뒤 다시 시도해 주세요.
            </p>
            {errorReference ? (
              <p className="error-reference">
                오류번호 <code>{errorReference}</code>
              </p>
            ) : null}
            <button
              className="button button-primary"
              onClick={reset}
              type="button"
            >
              다시 시도
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
