"use client";

import { useEffect } from "react";

import { getErrorReference } from "@/lib/observability/error-reference";

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
      <p className="eyebrow">오류</p>
      <h1>화면을 불러오지 못했습니다</h1>
      <p>
        자료는 변경되지 않았습니다. 잠시 뒤 다시 불러와 주세요.
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
  );
}
