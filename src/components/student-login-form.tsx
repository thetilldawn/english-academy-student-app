"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  readStudentCodeHash,
  normalizeStudentCodeInput,
  STUDENT_CODE_LENGTH,
} from "@/lib/auth/student-code-input";
import { studentAppText } from "@/content/ko/student-app";
import { Button } from "@/components/ui-button";

type LoginResponse = {
  error?: string;
};

const CODE_SLOT_GROUPS = [0, 1, 2] as const;

export function StudentLoginForm() {
  const codeInputRef = useRef<HTMLInputElement>(null);
  const requestInFlight = useRef(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const sharedCode = readStudentCodeHash(window.location.hash);
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    if (!sharedCode) return;
    const frameId = window.requestAnimationFrame(() => {
      setCode(sharedCode);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  function handleCodeChange(event: ChangeEvent<HTMLInputElement>) {
    setCode(normalizeStudentCodeInput(event.currentTarget.value));
    setError("");
  }

  function moveCaretToEnd() {
    const input = codeInputRef.current;
    if (!input) {
      return;
    }

    requestAnimationFrame(() => {
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (requestInFlight.current) {
      return;
    }

    if (code.length !== STUDENT_CODE_LENGTH) {
      setError(studentAppText.login.incompleteCode);
      codeInputRef.current?.focus();
      return;
    }

    requestInFlight.current = true;
    setError("");
    setSubmitting(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      15_000,
    );

    try {
      const response = await fetch("/api/student/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as LoginResponse;

      if (!response.ok) {
        setError(payload.error ?? studentAppText.login.invalidCode);
        requestInFlight.current = false;
        setSubmitting(false);
        return;
      }

      window.location.replace("/student");
    } catch {
      setError(
        controller.signal.aborted
          ? studentAppText.login.timeout
          : studentAppText.login.network,
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
      <div className="field">
        <label className="field-label" htmlFor="student-access-code">
          {studentAppText.login.codeLabel}
        </label>
        <div
          className="segmented-code-control"
          data-full={code.length === STUDENT_CODE_LENGTH}
          data-invalid={Boolean(error)}
        >
          <input
            ref={codeInputRef}
            aria-describedby="student-code-help"
            aria-errormessage={
              error ? "student-code-error" : undefined
            }
            aria-invalid={Boolean(error)}
            className="segmented-code-native"
            disabled={submitting}
            id="student-access-code"
            name="code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            enterKeyHint="go"
            maxLength={32}
            spellCheck={false}
            value={code}
            onChange={handleCodeChange}
            onClick={moveCaretToEnd}
            onFocus={moveCaretToEnd}
            autoFocus
          />
          <div
            aria-hidden="true"
            className="segmented-code-groups"
            data-complete={
              code.length === STUDENT_CODE_LENGTH && !error
            }
          >
            {CODE_SLOT_GROUPS.map((groupIndex) => (
              <Fragment key={groupIndex}>
                {groupIndex > 0 && (
                  <span className="segmented-code-separator">–</span>
                )}
                <div className="segmented-code-group">
                  {Array.from({ length: 4 }, (_, slotIndex) => {
                    const index = groupIndex * 4 + slotIndex;
                    const character = code[index] ?? "";
                    const active =
                      code.length < STUDENT_CODE_LENGTH &&
                      index === code.length;

                    return (
                      <span
                        className={[
                          "segmented-code-slot",
                          character ? "segmented-code-slot-filled" : "",
                          active ? "segmented-code-slot-active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={index}
                      >
                        {character}
                      </span>
                    );
                  })}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
        <span className="field-help" id="student-code-help">
          {studentAppText.login.codeHelp}
        </span>
      </div>
      {error && (
        <div
          className="notice notice-error"
          id="student-code-error"
          role="alert"
        >
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
          ? studentAppText.login.submitting
          : studentAppText.login.submit}
      </Button>
      <span aria-live="polite" className="sr-only" role="status">
        {submitting ? studentAppText.login.loading : ""}
      </span>
    </form>
  );
}
