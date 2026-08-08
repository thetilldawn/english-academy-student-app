"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui-button";
import { adminShellText } from "@/content/ko/admin-shell";

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
        setError(payload.error ?? adminShellText.login.error);
        requestInFlight.current = false;
        setSubmitting(false);
        return;
      }

      window.location.replace("/admin");
    } catch {
      setError(
        controller.signal.aborted
          ? adminShellText.login.timeout
          : adminShellText.login.network,
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
        <span className="field-label">{adminShellText.login.email}</span>
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
        <span className="field-label">{adminShellText.login.password}</span>
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
      <Button
        disabled={submitting}
        size="large"
        type="submit"
        variant="primary"
      >
        {submitting ? (
          <span aria-hidden="true" className="button-spinner" />
        ) : null}
        {submitting
          ? adminShellText.login.submitting
          : adminShellText.login.submit}
      </Button>
      <span aria-live="polite" className="sr-only" role="status">
        {submitting ? adminShellText.login.opening : ""}
      </span>
    </form>
  );
}
