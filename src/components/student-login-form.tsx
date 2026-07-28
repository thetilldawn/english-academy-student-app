"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type LoginResponse = {
  error?: string;
};

export function StudentLoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/student/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });
      const payload = (await response.json()) as LoginResponse;

      if (!response.ok) {
        setError(payload.error ?? "접속코드를 확인해주세요.");
        return;
      }

      router.replace("/student");
      router.refresh();
    } catch {
      setError("연결을 확인한 뒤 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">학생 접속코드</span>
        <input
          className="code-input"
          name="code"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          placeholder="ABCD-EFGH-IJKL"
          minLength={6}
          maxLength={32}
          required
          autoFocus
        />
        <span className="field-help">
          하이픈은 빼고 입력해도 됩니다.
        </span>
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
        {submitting ? "확인 중…" : "학습실 입장"}
      </button>
    </form>
  );
}
