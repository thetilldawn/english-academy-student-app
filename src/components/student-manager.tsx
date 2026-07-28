"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

type StudentItem = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  status: "active" | "blocked";
  codeGeneration: number;
  codeStatus: "active" | "blocked" | "missing";
};

type DatasetOption = {
  id: string;
  title: string;
  edition: string | null;
};

type ApiResponse = {
  code?: string;
  error?: string;
};

export function StudentManager({
  datasets,
  students,
}: {
  datasets: DatasetOption[];
  students: StudentItem[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [shownCode, setShownCode] = useState<{
    code: string;
    label: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState(
    students[0]?.id ?? "",
  );
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (
      shownCode &&
      dialogRef.current &&
      !dialogRef.current.open
    ) {
      dialogRef.current.showModal();
    }
  }, [shownCode]);

  function openCodeDialog(code: string, label: string) {
    setShownCode({ code, label });
  }

  function closeCodeDialog() {
    dialogRef.current?.close();
  }

  function finishClosingCodeDialog() {
    setShownCode(null);
  }

  function beginAction(key: string) {
    if (busyKey !== "") {
      return false;
    }

    setError("");
    setBusyKey(key);
    return true;
  }

  function finishAction() {
    setBusyKey("");
  }

  async function request(
    url: string,
    options?: RequestInit,
  ): Promise<ApiResponse> {
    const response = await fetch(url, options);
    let payload: ApiResponse = {};
    try {
      payload = (await response.json()) as ApiResponse;
    } catch {
      // 프록시 오류처럼 JSON이 아닌 응답은 아래의 안전한 기본 문구로 처리한다.
    }
    if (!response.ok) {
      throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
    }
    return payload;
  }

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!beginAction("create")) {
      return;
    }
    setCreateError("");

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
          currentVocabDatasetId: form.get("currentVocabDatasetId"),
          note: form.get("note"),
        }),
      });
      if (!payload.code) {
        throw new Error("새 접속코드를 받지 못했습니다.");
      }
      openCodeDialog(
        payload.code,
        `${String(form.get("displayName"))} 새 접속코드`,
      );
      formElement.reset();
      router.refresh();
    } catch (requestError) {
      setCreateError(
        requestError instanceof Error
          ? requestError.message
          : "학생을 만들지 못했습니다.",
      );
    } finally {
      finishAction();
    }
  }

  async function reveal(student: StudentItem) {
    if (!beginAction(`reveal:${student.id}`)) {
      return;
    }

    try {
      const payload = await request(
        `/api/admin/students/${student.id}/code`,
      );
      if (!payload.code) {
        throw new Error("접속코드를 받지 못했습니다.");
      }
      openCodeDialog(
        payload.code,
        `${student.displayName} 접속코드`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "접속코드를 불러오지 못했습니다.",
      );
    } finally {
      finishAction();
    }
  }

  async function rotate(student: StudentItem) {
    const accepted = window.confirm(
      `${student.displayName} 학생의 기존 접속을 모두 끊고 새 코드를 발급할까요?`,
    );
    if (!accepted) return;

    if (!beginAction(`rotate:${student.id}`)) {
      return;
    }

    try {
      const payload = await request(
        `/api/admin/students/${student.id}/code/rotate`,
        { method: "POST" },
      );
      if (!payload.code) {
        throw new Error("새 접속코드를 받지 못했습니다.");
      }
      openCodeDialog(
        payload.code,
        `${student.displayName} 새 접속코드`,
      );
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "접속코드를 바꾸지 못했습니다.",
      );
    } finally {
      finishAction();
    }
  }

  async function block(student: StudentItem) {
    const accepted = window.confirm(
      `${student.displayName} 학생의 코드와 현재 접속을 바로 차단할까요?`,
    );
    if (!accepted) return;

    if (!beginAction(`block:${student.id}`)) {
      return;
    }

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
      finishAction();
    }
  }

  async function copyCode() {
    if (!shownCode) return;
    await navigator.clipboard.writeText(shownCode.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const groupedStudents = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; students: StudentItem[] }
    >();

    for (const student of students) {
      const school = student.schoolName?.trim() || "학교 미입력";
      const grade = student.gradeLabel?.trim() || "학년 미입력";
      const key = `${school}\u0000${grade}`;
      const group = groups.get(key) ?? {
        label: `${school} · ${grade}`,
        students: [],
      };
      group.students.push(student);
      groups.set(key, group);
    }

    return Array.from(groups.values());
  }, [students]);
  const selectedStudent =
    students.find((student) => student.id === selectedStudentId) ??
    students[0] ??
    null;

  return (
    <>
      <div className="manager-toolbar">
        <div>
          <h2>등록 학생</h2>
          <p className="list-meta">학교와 학년별로 묶어 관리합니다.</p>
        </div>
        <span className="detail-chip">{students.length}명</span>
      </div>

      {error && (
        <div className="notice notice-error section" role="alert">
          {error}
        </div>
      )}

      <div className="student-admin-workspace">
        {groupedStudents.length > 0 && (
          <aside
            aria-label="학교·학년 그룹"
            className="card student-group-index"
          >
            <strong>학교·학년</strong>
            <nav>
              {groupedStudents.map((group, index) => (
                <a
                  href={`#student-group-${index}`}
                  key={group.label}
                >
                  <span>{group.label}</span>
                  <small>{group.students.length}명</small>
                </a>
              ))}
            </nav>
          </aside>
        )}

        <section className="student-group-pane">
          {groupedStudents.length === 0 ? (
            <div className="empty-state">
              아직 등록된 학생이 없습니다.
            </div>
          ) : (
            groupedStudents.map((group, groupIndex) => (
              <section
                className="student-group-section"
                id={`student-group-${groupIndex}`}
                key={group.label}
              >
                <div className="section-heading">
                  <h3>{group.label}</h3>
                  <span className="detail-chip">
                    {group.students.length}명
                  </span>
                </div>
                <div className="student-card-grid">
                  {group.students.map((student) => (
                    <article
                      className="card student-card"
                      data-selected={student.id === selectedStudent?.id}
                      key={student.id}
                    >
                      <div className="title-with-status">
                        <div>
                          <p className="list-title">
                            {student.displayName}
                          </p>
                          <p className="list-meta student-book-meta">
                            현재 단어장 ·{" "}
                            {student.currentVocabBook ?? "미입력"}
                          </p>
                          <p className="list-meta">
                            코드 {student.codeGeneration}차
                          </p>
                        </div>
                        <span
                          className={`status-pill status-${student.status}`}
                        >
                          {student.status === "active"
                            ? "접속 가능"
                            : "차단됨"}
                        </span>
                      </div>
                      <button
                        className="button button-quiet button-small student-select-button"
                        onClick={() => setSelectedStudentId(student.id)}
                        type="button"
                      >
                        {student.id === selectedStudent?.id
                          ? "선택됨"
                          : "관리 선택"}
                      </button>
                      <details className="student-actions-disclosure">
                        <summary className="button button-quiet button-small">
                          관리
                        </summary>
                        <div className="inline-actions student-card-actions">
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
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </section>

        <aside className="student-action-pane">
          {selectedStudent && (
            <section className="card student-action-panel">
              <div className="title-with-status">
                <div>
                  <p className="eyebrow">선택 학생 작업</p>
                  <h3>{selectedStudent.displayName}</h3>
                  <p className="list-meta">
                    {[
                      selectedStudent.schoolName,
                      selectedStudent.gradeLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "학교·학년 미입력"}
                  </p>
                  <p className="student-book-line">
                    <span>현재 단어장</span>
                    <strong>
                      {selectedStudent.currentVocabBook ?? "미입력"}
                    </strong>
                  </p>
                </div>
                <span
                  className={`status-pill status-${selectedStudent.status}`}
                >
                  {selectedStudent.status === "active"
                    ? "접속 가능"
                    : "차단됨"}
                </span>
              </div>
              <div className="form-stack section">
                {selectedStudent.status === "active" ? (
                  <>
                    <button
                      className="button button-quiet"
                      disabled={busyKey !== ""}
                      onClick={() => reveal(selectedStudent)}
                      type="button"
                    >
                      코드 보기
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={busyKey !== ""}
                      onClick={() => rotate(selectedStudent)}
                      type="button"
                    >
                      코드 교체
                    </button>
                    <button
                      className="button button-danger"
                      disabled={busyKey !== ""}
                      onClick={() => block(selectedStudent)}
                      type="button"
                    >
                      접속 차단
                    </button>
                  </>
                ) : (
                  <button
                    className="button button-primary"
                    disabled={busyKey !== ""}
                    onClick={() => rotate(selectedStudent)}
                    type="button"
                  >
                    새 코드로 재개
                  </button>
                )}
              </div>
            </section>
          )}

          <details className="card student-create-disclosure">
            <summary className="button button-primary">
              학생 추가
            </summary>
            <div className="student-create-content">
              <p className="auth-description">
                실명 대신 수업에서 구분할 이름만 적어도 됩니다.
              </p>
              <form
                aria-busy={busyKey === "create"}
                className="form-stack"
                onSubmit={createStudent}
              >
                <label className="field">
                  <span className="field-label-row">
                    <span className="field-label">학생 이름</span>
                    <span
                      className="field-requirement"
                      data-kind="required"
                    >
                      필수
                    </span>
                  </span>
                  <input
                    name="displayName"
                    required
                    maxLength={80}
                    placeholder="예: 김하늘"
                  />
                </label>
                <div className="form-grid-2">
                  <label className="field">
                    <span className="field-label-row">
                      <span className="field-label">학교</span>
                      <span className="field-requirement">선택</span>
                    </span>
                    <input
                      name="schoolName"
                      maxLength={120}
                      placeholder="예: 심석고등학교"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label-row">
                      <span className="field-label">학년</span>
                      <span className="field-requirement">선택</span>
                    </span>
                    <input
                      name="gradeLabel"
                      maxLength={40}
                      placeholder="예: 고1"
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field-label-row">
                    <span className="field-label">현재 단어장</span>
                    <span
                      className="field-requirement"
                      data-kind="required"
                    >
                      필수
                    </span>
                  </span>
                  <select
                    defaultValue=""
                    disabled={datasets.length === 0}
                    name="currentVocabDatasetId"
                    required
                  >
                    <option disabled value="">
                      {datasets.length === 0
                        ? "선택 가능한 단어장이 없습니다"
                        : "단어장 선택"}
                    </option>
                    {datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {[dataset.title, dataset.edition]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    ))}
                  </select>
                  <span className="field-help">
                    {datasets.length === 0
                      ? "검수 완료된 단어장이 등록되면 여기에 표시됩니다."
                      : "검수 완료되어 시험에 사용할 수 있는 단어장만 표시됩니다."}
                  </span>
                </label>
                <label className="field">
                  <span className="field-label-row">
                    <span className="field-label">관리 메모</span>
                    <span className="field-requirement">선택</span>
                  </span>
                  <textarea
                    name="note"
                    maxLength={2000}
                    placeholder="선택 사항"
                  />
                </label>
                {createError && (
                  <div className="notice notice-error" role="alert">
                    {createError}
                  </div>
                )}
                <button
                  className="button button-primary"
                  disabled={busyKey !== "" || datasets.length === 0}
                  type="submit"
                >
                  {busyKey === "create"
                    ? "만드는 중…"
                    : "학생과 코드 만들기"}
                </button>
              </form>
            </div>
          </details>
        </aside>
      </div>

      {shownCode && (
        <dialog
          aria-labelledby="student-code-title"
          className="dialog"
          onClose={finishClosingCodeDialog}
          ref={dialogRef}
        >
          <h2 id="student-code-title">{shownCode.label}</h2>
          <p className="auth-description">
            학생에게 이 코드만 전달하세요.
          </p>
          <div className="dialog-code">{shownCode.code}</div>
          <div className="inline-actions">
            <button
              autoFocus
              className="button button-primary"
              onClick={copyCode}
              type="button"
            >
              {copied ? "복사됨" : "코드 복사"}
            </button>
            <button
              className="button button-quiet"
              onClick={closeCodeDialog}
              type="button"
            >
              닫기
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
