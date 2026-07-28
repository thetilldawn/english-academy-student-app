"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ErrorResponse = {
  error?: string;
};

export function AdminLoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const payload = (await response.json()) as ErrorResponse;

      if (!response.ok) {
        setError(payload.error ?? "로그인하지 못했습니다.");
        return;
      }

      router.replace("/admin");
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
        <span className="field-label">관리자 이메일</span>
        <input
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
        {submitting ? "확인 중…" : "관리자 로그인"}
      </button>
    </form>
  );
}
