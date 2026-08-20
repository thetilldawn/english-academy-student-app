"use client";

import {
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  Button,
  ButtonSpinner,
} from "@/design-system/primitives/button/button";
import { adminShellText } from "@/content/ko/admin-shell";
import {
  Field,
  FieldLabel,
  Input,
} from "@/design-system/primitives/form/field";
import { Notice } from "@/design-system/patterns/feedback/feedback";

import styles from "./login-form.module.css";

type ErrorResponse = {
  error?: string;
};

function subscribeHydration() {
  return () => {};
}

function getHydratedSnapshot() {
  return true;
}

function getServerHydratedSnapshot() {
  return false;
}

export function AdminLoginForm() {
  const requestInFlight = useRef(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );

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
      aria-busy={!hydrated || submitting}
      className={styles.form}
      data-hydrated={hydrated ? "true" : "false"}
      onSubmit={handleSubmit}
    >
      <Field as="label" >
        <FieldLabel as="span" >{adminShellText.login.email}</FieldLabel>
        <Input
          disabled={!hydrated || submitting}
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </Field>
      <Field as="label" >
        <FieldLabel as="span" >{adminShellText.login.password}</FieldLabel>
        <Input
          disabled={!hydrated || submitting}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={200}
        />
      </Field>
      {error && (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      )}
      <Button
        disabled={!hydrated || submitting}
        size="large"
        type="submit"
        variant="primary"
      >
        {submitting ? (
          <ButtonSpinner />
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
