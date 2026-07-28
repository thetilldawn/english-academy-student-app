"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type StudentItem = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  status: "active" | "blocked";
  codeGeneration: number;
  codeStatus: "active" | "blocked" | "missing";
};

type ApiResponse = {
  code?: string;
  error?: string;
};

export function StudentManager({
  students,
}: {
  students: StudentItem[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [shownCode, setShownCode] = useState<{
    code: string;
    label: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function request(
    url: string,
    options?: RequestInit,
  ): Promise<ApiResponse> {
    const response = await fetch(url, options);
    const payload = (await response.json()) as ApiResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
    }
    return payload;
  }

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusyKey("create");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    try {
      const payload = await request("/api/admin/students", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: form.get("displayName"),
          schoolName: form.get("schoolName"),
          gradeLabel: form.get("gradeLabel"),
          note: form.get("note"),
        }),
      });
      if (!payload.code) {
        throw new Error("새 접속코드를 받지 못했습니다.");
      }
      setShownCode({
        code: payload.code,
        label: `${String(form.get("displayName"))} 새 접속코드`,
      });
      formElement.reset();
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "학생을 만들지 못했습니다.",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function reveal(student: StudentItem) {
    setError("");
    setBusyKey(`reveal:${student.id}`);
    try {
      const payload = await request(
        `/api/admin/students/${student.id}/code`,
      );
      if (!payload.code) {
        throw new Error("접속코드를 받지 못했습니다.");
      }
      setShownCode({
        code: payload.code,
        label: `${student.displayName} 접속코드`,
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "접속코드를 불러오지 못했습니다.",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function rotate(student: StudentItem) {
    const accepted = window.confirm(
      `${student.displayName} 학생의 기존 접속을 모두 끊고 새 코드를 발급할까요?`,
    );
    if (!accepted) return;

    setError("");
    setBusyKey(`rotate:${student.id}`);
    try {
      const payload = await request(
        `/api/admin/students/${student.id}/code/rotate`,
        { method: "POST" },
      );
      if (!payload.code) {
        throw new Error("새 접속코드를 받지 못했습니다.");
      }
      setShownCode({
        code: payload.code,
        label: `${student.displayName} 새 접속코드`,
      });
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "접속코드를 바꾸지 못했습니다.",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function block(student: StudentItem) {
    const accepted = window.confirm(
      `${student.displayName} 학생의 코드와 현재 접속을 바로 차단할까요?`,
    );
    if (!accepted) return;

    setError("");
    setBusyKey(`block:${student.id}`);
    try {
      await request(`/api/admin/students/${student.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "blocked" }),
      });
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "접속을 차단하지 못했습니다.",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function copyCode() {
    if (!shownCode) return;
    await navigator.clipboard.writeText(shownCode.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div className="split-panel">
        <section className="card sticky-panel">
          <h2>학생 추가</h2>
          <p className="auth-description">
            실명 대신 수업에서 구분할 이름만 적어도 됩니다.
          </p>
          <form className="form-stack" onSubmit={createStudent}>
            <label className="field">
              <span className="field-label">학생 이름</span>
              <input
                name="displayName"
                required
                maxLength={80}
                placeholder="예: 김하늘"
              />
            </label>
            <div className="form-grid-2">
              <label className="field">
                <span className="field-label">학교</span>
                <input
                  name="schoolName"
                  maxLength={120}
                  placeholder="선택"
                />
              </label>
              <label className="field">
                <span className="field-label">학년</span>
                <input
                  name="gradeLabel"
                  maxLength={40}
                  placeholder="예: 고1"
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">관리 메모</span>
              <textarea
                name="note"
                maxLength={2000}
                placeholder="선택 사항"
              />
            </label>
            {error && (
              <div className="notice notice-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="button button-primary"
              disabled={busyKey === "create"}
              type="submit"
            >
              {busyKey === "create" ? "만드는 중…" : "학생과 코드 만들기"}
            </button>
          </form>
        </section>

        <section>
          <div className="section-heading">
            <h2>등록 학생</h2>
            <span className="detail-chip">{students.length}명</span>
          </div>
          {students.length === 0 ? (
            <div className="empty-state">
              아직 등록된 학생이 없습니다.
            </div>
          ) : (
            <div className="list">
              {students.map((student) => (
                <article className="list-row" key={student.id}>
                  <div className="list-primary">
                    <div className="title-with-status">
                      <p className="list-title">{student.displayName}</p>
                      <span
                        className={`status-pill status-${student.status}`}
                      >
                        {student.status === "active" ? "접속 가능" : "차단됨"}
                      </span>
                    </div>
                    <p className="list-meta">
                      {[student.schoolName, student.gradeLabel]
                        .filter(Boolean)
                        .join(" · ") || "학교·학년 미입력"}
                      {" · "}
                      코드 {student.codeGeneration}차
                    </p>
                  </div>
                  <div className="inline-actions">
                    {student.status === "active" && (
                      <>
                        <button
                          className="button button-quiet button-small"
                          disabled={busyKey !== ""}
                          onClick={() => reveal(student)}
                          type="button"
                        >
                          코드 보기
                        </button>
                        <button
                          className="button button-secondary button-small"
                          disabled={busyKey !== ""}
                          onClick={() => rotate(student)}
                          type="button"
                        >
                          코드 교체
                        </button>
                        <button
                          className="button button-danger button-small"
                          disabled={busyKey !== ""}
                          onClick={() => block(student)}
                          type="button"
                        >
                          접속 차단
                        </button>
                      </>
                    )}
                    {student.status === "blocked" && (
                      <button
                        className="button button-primary button-small"
                        disabled={busyKey !== ""}
                        onClick={() => rotate(student)}
                        type="button"
                      >
                        새 코드로 재개
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {shownCode && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShownCode(null);
          }}
        >
          <section
            aria-labelledby="student-code-title"
            aria-modal="true"
            className="dialog"
            role="dialog"
          >
            <h2 id="student-code-title">{shownCode.label}</h2>
            <p className="auth-description">
              학생에게 이 코드만 전달하세요.
            </p>
            <div className="dialog-code">{shownCode.code}</div>
            <div className="inline-actions">
              <button
                className="button button-primary"
                onClick={copyCode}
                type="button"
              >
                {copied ? "복사됨" : "코드 복사"}
              </button>
              <button
                className="button button-quiet"
                onClick={() => setShownCode(null)}
                type="button"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
