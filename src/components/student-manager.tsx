"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  assignmentDisplayTitle,
  assignmentDisplayTitleForUnits,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import { buildStudentAccessUrl } from "@/lib/auth/student-code-input";
import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";
import { formatKoreanDateTime } from "@/lib/format";
import { sendKakaoText } from "@/lib/kakao-share";
import { AdminHistoryActions } from "@/components/admin-history-actions";
import { StudentWrongWordPanel } from "@/components/student-wrong-word-panel";
import {
  AttemptScoreSummary,
  AttemptStatusLabel,
} from "@/components/attempt-score-summary";
import {
  AssignmentMetaTags,
  MetaTag,
  MetaTagList,
} from "@/components/admin-meta-tags";
import { buildAttemptStatusPresentation } from "@/lib/ui/attempt-score-presentation";

type StudentItem = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  status: "active" | "blocked";
  codeGeneration: number;
  codeStatus: "active" | "blocked" | "missing";
};

type DatasetOption = {
  id: string;
  title: string;
  edition: string | null;
};

type ProgressItem = {
  studentId: string;
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestStatus:
    | "not_started"
    | "cancelled"
    | "missed"
    | "in_progress"
    | "completed"
    | "expired"
    | null;
  latestPhase: "initial" | "review" | "retry" | "completed" | null;
  latestScore: number | null;
  latestInitialScore: number | null;
  latestFinalScore: number | null;
  latestPassingScore: number | null;
  latestRetryStartedAt: string | null;
  latestPassed: boolean | null;
  latestUnitLabel: string | null;
  latestAttemptNumber: number | null;
  latestStartedAt: string | null;
  latestCompletedAt: string | null;
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitLabel: string | null;
  recommendationReason:
    | "first"
    | "assigned"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | "manual"
    | null;
};

type ApiResponse = {
  code?: string;
  error?: string;
};

type WrongHistoryCacheEntry = {
  history: StudentWrongWordHistory;
  loadedAt: number;
};

function progressStatusPresentation(progress: ProgressItem | null | undefined) {
  return buildAttemptStatusPresentation({
    status: progress?.latestStatus ?? null,
    phase: progress?.latestPhase ?? null,
    initialScore: progress?.latestInitialScore,
    finalScore: progress?.latestFinalScore,
    passingScore: progress?.latestPassingScore,
    retryStartedAt: progress?.latestRetryStartedAt,
  });
}

function studentRecommendationLabel(
  progress: ProgressItem | null | undefined,
) {
  if (progress?.recommendationReason === "complete") {
    return "현재 단어장 완료";
  }
  if (progress?.recommendationReason === "manual") {
    return "DAY 범위 확인 필요";
  }
  return progress?.recommendedUnitLabel ?? "단어장 선택 필요";
}

export function StudentManager({
  appOrigin,
  datasets,
  history,
  initialStudentId = "",
  progress,
  students,
}: {
  appOrigin: string;
  datasets: DatasetOption[];
  history: AssignmentHistorySummary[];
  initialStudentId?: string;
  progress: ProgressItem[];
  students: StudentItem[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [refreshPending, startRefreshTransition] = useTransition();
  const [shownCode, setShownCode] = useState<{
    code: string;
    label: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const initialStudent =
    students.find((student) => student.id === initialStudentId) ?? null;
  const [selectedStudentId, setSelectedStudentId] = useState(
    initialStudent?.id ?? "",
  );
  const [activeTab, setActiveTab] = useState<
    "history" | "wrong" | "manage"
  >("history");
  const [wrongHistoryByStudent, setWrongHistoryByStudent] = useState<
    Record<string, WrongHistoryCacheEntry>
  >({});
  const selectedStudent =
    students.find((student) => student.id === selectedStudentId) ?? null;
  const selectedProgress =
    progress.find((item) => item.studentId === selectedStudent?.id) ??
    null;
  const [profileDatasetId, setProfileDatasetId] = useState(
    selectedStudent?.currentVocabDatasetId ?? "",
  );
  const studentDialogRef = useRef<HTMLDialogElement>(null);
  const codeDialogRef = useRef<HTMLDialogElement>(null);
  const interactionBusy = busyKey !== "" || refreshPending;

  useEffect(() => {
    if (
      shownCode &&
      codeDialogRef.current &&
      !codeDialogRef.current.open
    ) {
      codeDialogRef.current.showModal();
    }
  }, [shownCode]);

  useEffect(() => {
    if (
      selectedStudent &&
      studentDialogRef.current &&
      !studentDialogRef.current.open
    ) {
      studentDialogRef.current.showModal();
    }
  }, [selectedStudent]);

  function openCodeDialog(code: string, label: string) {
    setShownCode({ code, label });
  }

  function closeCodeDialog() {
    codeDialogRef.current?.close();
  }

  function finishClosingCodeDialog() {
    setShownCode(null);
  }

  function selectStudent(
    student: StudentItem,
    tab: "history" | "wrong" | "manage" = "history",
  ) {
    setSelectedStudentId(student.id);
    setActiveTab(tab);
    setProfileDatasetId(student.currentVocabDatasetId ?? "");
  }

  const cacheWrongWordHistory = useCallback(
    (studentId: string, history: StudentWrongWordHistory) => {
      setWrongHistoryByStudent((current) => ({
        ...current,
        [studentId]: {
          history,
          loadedAt: Date.now(),
        },
      }));
    },
    [],
  );

  function moveDialogTabFocus(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
        event.key,
      )
    ) {
      return;
    }
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      ) ?? [],
    );
    if (tabs.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(
      tabs.indexOf(event.currentTarget),
      0,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  }

  function beginAction(key: string) {
    if (interactionBusy) {
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
      startRefreshTransition(() => router.refresh());
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

  async function saveCurrentDataset() {
    if (
      !selectedStudent ||
      !beginAction(`vocab:${selectedStudent.id}`)
    ) {
      return;
    }

    try {
      await request(
        `/api/admin/students/${selectedStudent.id}/vocab`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currentVocabDatasetId: profileDatasetId,
          }),
        },
      );
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "현재 단어장을 바꾸지 못했습니다.",
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
      startRefreshTransition(() => router.refresh());
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
      startRefreshTransition(() => router.refresh());
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

  async function deleteSelectedStudent() {
    if (!selectedStudent) return;
    const accepted = window.confirm(
      `${selectedStudent.displayName} 학생을 삭제할까요? 학생의 접속은 즉시 차단되고 목록에서는 사라집니다. 진행 중인 시험은 종료 처리하며 기존 시험·성적은 보존되어 내역에는 '삭제됨'으로 표시됩니다.`,
    );
    if (
      !accepted ||
      !beginAction(`delete:${selectedStudent.id}`)
    ) {
      return;
    }

    try {
      await request(`/api/admin/students/${selectedStudent.id}`, {
        method: "DELETE",
      });
      closeStudentDialog();
      setSelectedStudentId("");
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "학생을 삭제하지 못했습니다.",
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

  async function shareCode() {
    if (!shownCode) return;
    const studentAccessUrl = buildStudentAccessUrl(
      appOrigin,
      shownCode.code,
    );
    const message = [
      shownCode.label,
      `접속 주소: ${studentAccessUrl}`,
      `접속 코드: ${shownCode.code}`,
    ].join("\n");

    const result = await sendKakaoText({
      title: shownCode.label,
      message,
      url: studentAccessUrl,
    });
    if (result === "sent") {
      setShareNotice("");
      return;
    }
    await navigator.clipboard.writeText(message);
    setShareNotice(
      result === "unconfigured"
        ? "카카오 설정 전이라 메시지를 복사했습니다."
        : "카카오톡을 열지 못해 메시지를 복사했습니다.",
    );
    window.setTimeout(() => setShareNotice(""), 2500);
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
  const progressByStudent = useMemo(
    () => new Map(progress.map((item) => [item.studentId, item])),
    [progress],
  );
  const selectedStudentHistory = useMemo(
    () =>
      selectedStudent
        ? history.filter((item) => item.studentId === selectedStudent.id)
        : [],
    [history, selectedStudent],
  );

  function closeStudentDialog() {
    studentDialogRef.current?.close();
  }

  function closeStudentDialogOnBackdrop(
    event: MouseEvent<HTMLDialogElement>,
  ) {
    if (event.target === event.currentTarget) closeStudentDialog();
  }

  return (
    <>
      <div className="manager-toolbar">
        <div>
          <h2>등록 학생</h2>
          <p className="list-meta">
            학생을 누르면 내역과 관리 메뉴가 열립니다.
          </p>
        </div>
        <span className="detail-chip">{students.length}명</span>
      </div>

      {error && (
        <div className="notice notice-error section" role="alert">
          {error}
        </div>
      )}

      <details className="card student-create-disclosure">
        <summary className="button button-primary">학생 추가</summary>
        <div className="student-create-content">
          <p className="auth-description">
            실명 대신 수업에서 구분할 이름만 적어도 됩니다.
          </p>
          <form
            aria-busy={busyKey === "create" || refreshPending}
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
                maxLength={80}
                name="displayName"
                placeholder="예: 김하늘"
                required
              />
            </label>
            <div className="form-grid-2">
              <label className="field">
                <span className="field-label-row">
                  <span className="field-label">학교</span>
                  <span className="field-requirement">선택</span>
                </span>
                <input
                  maxLength={120}
                  name="schoolName"
                  placeholder="예: 심석고등학교"
                />
              </label>
              <label className="field">
                <span className="field-label-row">
                  <span className="field-label">학년</span>
                  <span className="field-requirement">선택</span>
                </span>
                <input
                  maxLength={40}
                  name="gradeLabel"
                  placeholder="예: 고1"
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label-row">
                <span className="field-label">현재 단어장</span>
                <span className="field-requirement">선택</span>
              </span>
              <select defaultValue="" name="currentVocabDatasetId">
                <option value="">나중에 선택</option>
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
                  ? "단어장 없이 학생과 코드부터 만들 수 있습니다."
                  : "아직 정하지 않았다면 나중에 선택할 수 있습니다."}
              </span>
            </label>
            <label className="field">
              <span className="field-label-row">
                <span className="field-label">관리 메모</span>
                <span className="field-requirement">선택</span>
              </span>
              <textarea
                maxLength={2000}
                name="note"
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
              disabled={interactionBusy}
              type="submit"
            >
              {busyKey === "create"
                ? "만드는 중…"
                : refreshPending
                  ? "화면에 반영하는 중…"
                  : "학생과 코드 만들기"}
            </button>
          </form>
        </div>
      </details>

      <section className="student-group-pane">
        {groupedStudents.length === 0 ? (
          <div className="empty-state">아직 등록된 학생이 없습니다.</div>
        ) : (
          groupedStudents.map((group) => (
            <section className="student-group-section" key={group.label}>
              <div className="section-heading">
                <h3>{group.label}</h3>
                <span className="detail-chip">
                  {group.students.length}명
                </span>
              </div>
              <div className="student-card-grid">
                {group.students.map((student) => {
                  const studentProgress = progressByStudent.get(student.id);
                  return (
                    <button
                      className="card student-card student-card-button"
                      data-exam-outcome={
                        progressStatusPresentation(studentProgress).outcome
                      }
                      key={student.id}
                      onClick={() => selectStudent(student)}
                      type="button"
                    >
                      <span className="student-card-heading">
                        <strong className="list-title">
                          {student.displayName}
                        </strong>
                        <MetaTagList>
                          <MetaTag>
                            단어장 · {student.currentVocabBook ?? "미입력"}
                          </MetaTag>
                          <MetaTag
                            tone={
                              student.status === "active"
                                ? "positive"
                                : "danger"
                            }
                          >
                            {student.status === "active"
                              ? "접속 가능"
                              : "차단됨"}
                          </MetaTag>
                          <MetaTag tone="warning">
                            다음 · {studentRecommendationLabel(studentProgress)}
                          </MetaTag>
                        </MetaTagList>
                      </span>
                      <span className="student-card-summary">
                        <span className="student-card-section">
                          <span className="student-card-section-heading">
                            <small>최근 시험</small>
                            {studentProgress?.latestUnitLabel ? (
                              <MetaTag>{studentProgress.latestUnitLabel}</MetaTag>
                            ) : null}
                          </span>
                          <strong>
                            {studentProgress?.latestAssignmentTitle
                              ? assignmentDisplayTitleForUnits(
                                  studentProgress.latestAssignmentTitle,
                                  studentProgress.latestUnitLabel
                                    ? [studentProgress.latestUnitLabel]
                                    : [],
                                )
                              : "시험 기록 없음"}
                          </strong>
                          <span className="student-card-score-line">
                            <AttemptStatusLabel
                              finalScore={studentProgress?.latestFinalScore}
                              initialScore={studentProgress?.latestInitialScore}
                              passingScore={studentProgress?.latestPassingScore}
                              phase={studentProgress?.latestPhase ?? null}
                              retryStartedAt={studentProgress?.latestRetryStartedAt}
                              status={studentProgress?.latestStatus ?? null}
                            />
                            <AttemptScoreSummary
                              finalScore={studentProgress?.latestFinalScore}
                              initialScore={studentProgress?.latestInitialScore}
                              passingScore={studentProgress?.latestPassingScore}
                              phase={studentProgress?.latestPhase ?? null}
                              retryStartedAt={studentProgress?.latestRetryStartedAt}
                              status={studentProgress?.latestStatus ?? null}
                            />
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </section>

      {selectedStudent && (
        <dialog
          aria-labelledby="student-detail-title"
          className="dialog dialog-wide student-detail-dialog"
          onClick={closeStudentDialogOnBackdrop}
          onClose={() => setSelectedStudentId("")}
          ref={studentDialogRef}
        >
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">학생</p>
              <h2 id="student-detail-title">
                {selectedStudent.displayName}
              </h2>
              <p>
                {[
                  selectedStudent.schoolName,
                  selectedStudent.gradeLabel,
                ]
                  .filter(Boolean)
                  .join(" · ") || "학교·학년 미입력"}
              </p>
            </div>
            <button
              aria-label="닫기"
              className="button button-quiet button-small"
              onClick={closeStudentDialog}
              type="button"
            >
              닫기
            </button>
          </div>

          <div
            aria-label="학생 상세 메뉴"
            className="dialog-tabs"
            role="tablist"
          >
            <button
              aria-controls="student-history-panel"
              aria-selected={activeTab === "history"}
              className="dialog-tab"
              id="student-history-tab"
              onKeyDown={moveDialogTabFocus}
              onClick={() => setActiveTab("history")}
              role="tab"
              tabIndex={activeTab === "history" ? 0 : -1}
              type="button"
            >
              내역
            </button>
            <button
              aria-controls="student-wrong-panel"
              aria-selected={activeTab === "wrong"}
              className="dialog-tab"
              id="student-wrong-tab"
              onKeyDown={moveDialogTabFocus}
              onClick={() => setActiveTab("wrong")}
              role="tab"
              tabIndex={activeTab === "wrong" ? 0 : -1}
              type="button"
            >
              오답
            </button>
            <button
              aria-controls="student-manage-panel"
              aria-selected={activeTab === "manage"}
              className="dialog-tab"
              id="student-manage-tab"
              onKeyDown={moveDialogTabFocus}
              onClick={() => setActiveTab("manage")}
              role="tab"
              tabIndex={activeTab === "manage" ? 0 : -1}
              type="button"
            >
              관리
            </button>
          </div>

          {activeTab === "history" ? (
            <section
              aria-labelledby="student-history-tab"
              className="student-dialog-panel"
              id="student-history-panel"
              role="tabpanel"
            >
              <div className="student-progress-grid">
                <div>
                  <span>최근 시험</span>
                  <strong>
                    {selectedProgress?.latestAssignmentTitle ??
                      "시험 기록 없음"}
                  </strong>
                  <small>
                    {progressStatusPresentation(selectedProgress).label}
                    {selectedProgress?.latestUnitLabel
                      ? ` · ${selectedProgress.latestUnitLabel}`
                      : ""}
                  </small>
                </div>
                <div>
                  <span>점수</span>
                  <AttemptScoreSummary
                    className="student-progress-score"
                    finalScore={selectedProgress?.latestFinalScore}
                    initialScore={selectedProgress?.latestInitialScore}
                    passingScore={selectedProgress?.latestPassingScore}
                    phase={selectedProgress?.latestPhase ?? null}
                    retryStartedAt={selectedProgress?.latestRetryStartedAt}
                    status={selectedProgress?.latestStatus ?? null}
                  />
                  <small>
                    {selectedProgress?.latestCompletedAt
                      ? formatKoreanDateTime(
                          selectedProgress.latestCompletedAt,
                        )
                      : "완료 시각 없음"}
                  </small>
                </div>
              </div>

              <div className="student-history-list">
                {selectedStudentHistory.length === 0 ? (
                  <div className="empty-state">
                    배정된 시험이 없습니다.
                  </div>
                ) : (
                  selectedStudentHistory.map((item) => (
                    <article
                      className="student-history-row"
                      data-exam-outcome={
                        buildAttemptStatusPresentation({
                          status: item.status,
                          phase: item.phase,
                          initialScore: item.initialScore,
                          finalScore: item.finalScore,
                          passingScore: item.passingScore,
                          retryStartedAt: item.retryStartedAt,
                        }).outcome
                      }
                      key={item.id}
                    >
                      <div>
                        <strong>{assignmentDisplayTitle(item)}</strong>
                        <AssignmentMetaTags {...item} />
                        <small className="card-time-meta">
                          {formatKoreanDateTime(item.activityAt)}
                        </small>
                      </div>
                      <div className="student-history-actions">
                        <AttemptStatusLabel
                          finalScore={item.finalScore}
                          initialScore={item.initialScore}
                          passingScore={item.passingScore}
                          phase={item.phase}
                          retryStartedAt={item.retryStartedAt}
                          status={item.status}
                        />
                        <AttemptScoreSummary
                          finalScore={item.finalScore}
                          initialScore={item.initialScore}
                          passingScore={item.passingScore}
                          phase={item.phase}
                          retryStartedAt={item.retryStartedAt}
                          status={item.status}
                        />
                        {item.attemptId && (
                          <Link
                            className="button button-quiet button-small"
                            href={`/admin/results/${item.attemptId}`}
                          >
                            내역 보기
                          </Link>
                        )}
                        <AdminHistoryActions
                          item={item}
                          size="small"
                        />
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : activeTab === "wrong" ? (
            <div
              aria-labelledby="student-wrong-tab"
              id="student-wrong-panel"
              role="tabpanel"
            >
              <StudentWrongWordPanel
                active
                cachedAt={
                  wrongHistoryByStudent[selectedStudent.id]?.loadedAt ??
                  null
                }
                cachedHistory={
                  wrongHistoryByStudent[selectedStudent.id]?.history ??
                  null
                }
                key={selectedStudent.id}
                onLoaded={cacheWrongWordHistory}
                studentId={selectedStudent.id}
              />
            </div>
          ) : (
            <section
              aria-labelledby="student-manage-tab"
              className="student-dialog-panel"
              id="student-manage-panel"
              role="tabpanel"
            >
              <div className="student-management-summary">
                <div>
                  <span>현재 단어장</span>
                  <strong>
                    {selectedStudent.currentVocabBook ?? "미입력"}
                  </strong>
                </div>
                <span
                  className={`status-pill status-${selectedStudent.status}`}
                >
                  {selectedStudent.status === "active"
                    ? "접속 가능"
                    : "차단됨"}
                </span>
              </div>

              <div className="student-book-form">
                <label className="field">
                  <span className="field-label">현재 단어장 변경</span>
                  <select
                    onChange={(event) =>
                      setProfileDatasetId(event.target.value)
                    }
                    value={profileDatasetId}
                  >
                    <option value="">나중에 선택</option>
                    {datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {[dataset.title, dataset.edition]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary"
                  disabled={
                    interactionBusy ||
                    profileDatasetId ===
                      (selectedStudent.currentVocabDatasetId ?? "")
                  }
                  onClick={saveCurrentDataset}
                  type="button"
                >
                  현재 단어장 저장
                </button>
              </div>

              <div className="dialog-actions">
                {selectedStudent.status === "active" ? (
                  <>
                    <Link
                      className="button button-primary assignment-launch-button"
                      href={`/admin/assignments?student=${selectedStudent.id}`}
                    >
                      새 단어 시험 배정
                    </Link>
                    <button
                      className="button button-quiet"
                      disabled={interactionBusy}
                      onClick={() => reveal(selectedStudent)}
                      type="button"
                    >
                      코드 보기
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={interactionBusy}
                      onClick={() => rotate(selectedStudent)}
                      type="button"
                    >
                      코드 교체
                    </button>
                    <button
                      className="button button-danger"
                      disabled={interactionBusy}
                      onClick={() => block(selectedStudent)}
                      type="button"
                    >
                      접속 차단
                    </button>
                  </>
                ) : (
                  <button
                    className="button button-primary"
                    disabled={interactionBusy}
                    onClick={() => rotate(selectedStudent)}
                    type="button"
                  >
                    새 코드로 재개
                  </button>
                )}
                <button
                  className="button button-danger"
                  disabled={interactionBusy}
                  onClick={() => void deleteSelectedStudent()}
                  type="button"
                >
                  {busyKey === `delete:${selectedStudent.id}`
                    ? "학생 삭제 중…"
                    : "학생 삭제"}
                </button>
              </div>
            </section>
          )}
        </dialog>
      )}

      {shownCode && (
        <dialog
          aria-labelledby="student-code-title"
          className="dialog"
          onClose={finishClosingCodeDialog}
          ref={codeDialogRef}
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
              onClick={() => void shareCode()}
              type="button"
            >
              카카오톡으로 보내기
            </button>
            {shareNotice && (
              <span className="field-help" role="status">
                {shareNotice}
              </span>
            )}
            <button
              className="button button-secondary"
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
