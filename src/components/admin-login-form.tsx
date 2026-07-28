"use client";

import { useRef, useState, type FormEvent } from "react";

type ErrorResponse = {
  error?: string;
};

export function AdminLoginForm() {
  const requestInFlight = useRef(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    setError("");
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      15_000,
    );

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as ErrorResponse;

      if (!response.ok) {
        setError(payload.error ?? "로그인하지 못했습니다.");
        requestInFlight.current = false;
        setSubmitting(false);
        return;
      }

      window.location.replace("/admin");
    } catch {
      setError(
        controller.signal.aborted
          ? "응답이 늦어지고 있습니다. 다시 시도해주세요."
          : "연결을 확인한 뒤 다시 시도해주세요.",
      );
      requestInFlight.current = false;
      setSubmitting(false);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  return (
    <form
      aria-busy={submitting}
      className="form-stack"
      onSubmit={handleSubmit}
    >
      <label className="field">
        <span className="field-label">관리자 이메일</span>
        <input
          disabled={submitting}
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label className="field">
        <span className="field-label">비밀번호</span>
        <input
          disabled={submitting}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={200}
        />
      </label>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <button
        className="button button-primary button-large"
        disabled={submitting}
        type="submit"
      >
        {submitting ? (
          <span aria-hidden="true" className="button-spinner" />
        ) : null}
        {submitting ? "로그인 중…" : "관리자 로그인"}
      </button>
      <span aria-live="polite" className="sr-only" role="status">
        {submitting ? "관리자 확인 후 화면을 여는 중입니다." : ""}
      </span>
    </form>
  );
}
