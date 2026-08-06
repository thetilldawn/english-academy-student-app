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
import { useRouter } from "next/navigation";

import {
  assignmentDisplayTitleForUnits,
  type AssignmentHistorySummary,
} from "@/lib/admin/history";
import { buildStudentAccessUrl } from "@/lib/auth/student-code-input";
import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";
import { sendKakaoText } from "@/lib/kakao-share";
import { StudentWrongWordPanel } from "@/components/student-wrong-word-panel";
import { StudentLearningActivityList } from "@/components/student-learning-activity-list";
import {
  AssignmentManager,
  type AssignmentDatasetItem,
  type AssignmentUnitItem,
} from "@/components/assignment-manager";
import {
  AttemptScoreSummary,
  AttemptStatusLabel,
} from "@/components/attempt-score-summary";
import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { buildAttemptStatusPresentation } from "@/lib/ui/attempt-score-presentation";
import {
  compareLearningActivities,
  learningActivityBucket,
  studentLearningActivityIndex,
} from "@/lib/admin/learning-activity";
import type { StudentPendingReviewSummary } from "@/lib/admin/review-queue-summary";
import type { StudentCurrentVocabWrongSummary } from "@/lib/admin/wrong-history-summary";

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
  latestCompletedAssignmentTitle: string | null;
  latestCompletedInitialScore: number | null;
  latestCompletedFinalScore: number | null;
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
  assignmentDatasets,
  assignmentUnits,
  currentVocabWrongSummaries,
  datasets,
  history,
  initialStudentId = "",
  pendingReviewSummaries,
  progress,
  students,
}: {
  appOrigin: string;
  assignmentDatasets: AssignmentDatasetItem[];
  assignmentUnits: AssignmentUnitItem[];
  currentVocabWrongSummaries: StudentCurrentVocabWrongSummary[];
  datasets: DatasetOption[];
  history: AssignmentHistorySummary[];
  initialStudentId?: string;
  pendingReviewSummaries: StudentPendingReviewSummary[];
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
    "learning" | "account" | "history"
  >("learning");
  const [learningView, setLearningView] = useState<
    "summary" | "vocab" | "passage"
  >("summary");
  const [assignmentStudentId, setAssignmentStudentId] = useState("");
  const [query, setQuery] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [wordbookFilter, setWordbookFilter] = useState("");
  const [learningFilter, setLearningFilter] = useState<
    "all" | "open" | "attention"
  >("all");
  const [wrongHistoryByStudent, setWrongHistoryByStudent] = useState<
    Record<string, WrongHistoryCacheEntry>
  >({});
  const selectedStudent =
    students.find((student) => student.id === selectedStudentId) ?? null;
  const [profileDatasetId, setProfileDatasetId] = useState(
    selectedStudent?.currentVocabDatasetId ?? "",
  );
  const [profileDisplayName, setProfileDisplayName] = useState(
    selectedStudent?.displayName ?? "",
  );
  const [profileSchoolName, setProfileSchoolName] = useState(
    selectedStudent?.schoolName ?? "",
  );
  const [profileGradeLabel, setProfileGradeLabel] = useState(
    selectedStudent?.gradeLabel ?? "",
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
    tab: "learning" | "account" | "history" = "learning",
  ) {
    setSelectedStudentId(student.id);
    setActiveTab(tab);
    setLearningView("summary");
    setProfileDatasetId(student.currentVocabDatasetId ?? "");
    setProfileDisplayName(student.displayName);
    setProfileSchoolName(student.schoolName ?? "");
    setProfileGradeLabel(student.gradeLabel ?? "");
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

  async function saveStudentProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedStudent ||
      !profileDisplayName.trim() ||
      !beginAction(`profile:${selectedStudent.id}`)
    ) {
      return;
    }

    try {
      await request(`/api/admin/students/${selectedStudent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: profileDisplayName,
          schoolName: profileSchoolName,
          gradeLabel: profileGradeLabel,
        }),
      });
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "학생 정보를 저장하지 못했습니다.",
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

  const activitiesByStudent = useMemo(
    () => studentLearningActivityIndex(history),
    [history],
  );
  const schoolOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .map((student) => student.schoolName?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [students],
  );
  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .map((student) => student.gradeLabel?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [students],
  );
  const wordbookOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .map((student) => student.currentVocabBook?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [students],
  );
  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    return students.filter((student) => {
      const text = [
        student.displayName,
        student.schoolName,
        student.gradeLabel,
        student.currentVocabBook,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      const activities = activitiesByStudent.get(student.id) ?? [];
      const matchesLearning =
        learningFilter === "all" ||
        (learningFilter === "open" &&
          activities.some((item) =>
            ["open_without_deadline", "open_with_deadline", "in_progress"].includes(
              learningActivityBucket(item),
            ),
          )) ||
        (learningFilter === "attention" &&
          activities.some(
            (item) => learningActivityBucket(item) === "needs_attention",
          ));
      return (
        (!keyword || text.includes(keyword)) &&
        (!schoolFilter || student.schoolName === schoolFilter) &&
        (!gradeFilter || student.gradeLabel === gradeFilter) &&
        (!wordbookFilter || student.currentVocabBook === wordbookFilter) &&
        matchesLearning
      );
    }).toSorted((left, right) => {
      const leftActivity = activitiesByStudent.get(left.id)?.[0] ?? null;
      const rightActivity = activitiesByStudent.get(right.id)?.[0] ?? null;
      if (leftActivity && rightActivity) {
        const activityOrder = compareLearningActivities(
          leftActivity,
          rightActivity,
        );
        if (activityOrder !== 0) return activityOrder;
      } else if (leftActivity) {
        return -1;
      } else if (rightActivity) {
        return 1;
      }
      return left.displayName.localeCompare(right.displayName, "ko-KR");
    });
  }, [
    activitiesByStudent,
    gradeFilter,
    learningFilter,
    query,
    schoolFilter,
    students,
    wordbookFilter,
  ]);
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

      <div className="learning-search-panel student-search-panel">
        <label className="learning-search-field">
          <span aria-hidden="true" className="learning-search-icon">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>
          </span>
          <span className="sr-only">학생 및 학습 자료 검색</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름·학교·학년·단어장 검색"
            type="search"
            value={query}
          />
        </label>
        <details className="learning-filter-disclosure">
          <summary>
            <span>필터</span>
            <span className="detail-chip">
              {
                [schoolFilter, gradeFilter, wordbookFilter].filter(Boolean)
                  .length + (learningFilter === "all" ? 0 : 1)
              }
            </span>
          </summary>
          <div className="learning-filter-groups">
            <fieldset>
              <legend>학습 상태</legend>
              <div className="filter-chip-row">
                {(
                  [
                    ["all", "전체"],
                    ["open", "진행할 학습 있음"],
                    ["attention", "확인 필요"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-pressed={learningFilter === value}
                    className="filter-chip"
                    key={value}
                    onClick={() => setLearningFilter(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>학교별</legend>
              <div className="filter-chip-row">
                {schoolOptions.map((school) => (
                  <button
                    aria-pressed={schoolFilter === school}
                    className="filter-chip"
                    key={school}
                    onClick={() =>
                      setSchoolFilter((current) =>
                        current === school ? "" : school,
                      )
                    }
                    type="button"
                  >
                    {school}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>학년별</legend>
              <div className="filter-chip-row">
                {gradeOptions.map((grade) => (
                  <button
                    aria-pressed={gradeFilter === grade}
                    className="filter-chip"
                    key={grade}
                    onClick={() =>
                      setGradeFilter((current) =>
                        current === grade ? "" : grade,
                      )
                    }
                    type="button"
                  >
                    {grade}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>단어장별</legend>
              <div className="filter-chip-row">
                {wordbookOptions.map((wordbook) => (
                  <button
                    aria-pressed={wordbookFilter === wordbook}
                    className="filter-chip"
                    key={wordbook}
                    onClick={() =>
                      setWordbookFilter((current) =>
                        current === wordbook ? "" : wordbook,
                      )
                    }
                    type="button"
                  >
                    {wordbook}
                  </button>
                ))}
              </div>
            </fieldset>
            <button
              className="button button-quiet button-small"
              onClick={() => {
                setSchoolFilter("");
                setGradeFilter("");
                setWordbookFilter("");
                setLearningFilter("all");
              }}
              type="button"
            >
              필터 초기화
            </button>
          </div>
        </details>
        <div className="learning-filter-summary">
          <MetaTagList>
            {schoolFilter ? <MetaTag>{schoolFilter}</MetaTag> : null}
            {gradeFilter ? <MetaTag>{gradeFilter}</MetaTag> : null}
            {wordbookFilter ? <MetaTag>{wordbookFilter}</MetaTag> : null}
            {learningFilter !== "all" ? (
              <MetaTag tone="warning">
                {learningFilter === "open" ? "진행할 학습 있음" : "확인 필요"}
              </MetaTag>
            ) : null}
          </MetaTagList>
          <strong>{filteredStudents.length}명</strong>
        </div>
      </div>

      <section className="student-group-pane">
        {filteredStudents.length === 0 ? (
          <div className="empty-state">조건에 맞는 학생이 없습니다.</div>
        ) : (
          <div className="student-card-grid">
                {filteredStudents.map((student) => {
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
                            {student.schoolName ?? "학교 미입력"}
                          </MetaTag>
                          <MetaTag>
                            {student.gradeLabel ?? "학년 미입력"}
                          </MetaTag>
                          <MetaTag>
                            {student.currentVocabBook ?? "단어장 미입력"}
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
        )}
      </section>

      {selectedStudent && (
        <dialog
          aria-labelledby="student-detail-title"
          className="dialog dialog-wide student-detail-dialog"
          onClick={closeStudentDialogOnBackdrop}
          onClose={() => {
            setSelectedStudentId("");
            setLearningView("summary");
          }}
          ref={studentDialogRef}
        >
          <div className="dialog-heading">
            <div>
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
              aria-controls="student-learning-panel"
              aria-selected={activeTab === "learning"}
              className="dialog-tab"
              id="student-learning-tab"
              onKeyDown={moveDialogTabFocus}
              onClick={() => {
                setActiveTab("learning");
                setLearningView("summary");
              }}
              role="tab"
              tabIndex={activeTab === "learning" ? 0 : -1}
              type="button"
            >
              학습 관리
            </button>
            <button
              aria-controls="student-account-panel"
              aria-selected={activeTab === "account"}
              className="dialog-tab"
              id="student-account-tab"
              onKeyDown={moveDialogTabFocus}
              onClick={() => setActiveTab("account")}
              role="tab"
              tabIndex={activeTab === "account" ? 0 : -1}
              type="button"
            >
              계정 설정
            </button>
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
          </div>

          <div className="student-dialog-scroll-region">
            {activeTab === "learning" ? (
              <section
                aria-labelledby="student-learning-tab"
                className="student-dialog-panel"
                id="student-learning-panel"
                role="tabpanel"
              >
                {learningView === "summary" ? (
                  <>
                    <div className="student-learning-source-row">
                      <div>
                        <span>주 단어장</span>
                        <strong>
                          {selectedStudent.currentVocabBook ?? "미선택"}
                        </strong>
                      </div>
                      <button
                        aria-label="단어 학습 관리 열기"
                        className="learning-add-button"
                        onClick={() => setLearningView("vocab")}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                    <div className="student-book-form compact-learning-form">
                      <label className="field">
                        <span className="field-label">주 단어장 변경</span>
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
                        저장
                      </button>
                    </div>
                    <div className="student-learning-launch-grid">
                      <button
                        className="student-learning-launch"
                        onClick={() => setLearningView("vocab")}
                        type="button"
                      >
                        <span>단어</span>
                        <strong>범위·오답·배정 관리</strong>
                        <span aria-hidden="true">→</span>
                      </button>
                      <button
                        className="student-learning-launch"
                        onClick={() => setLearningView("passage")}
                        type="button"
                      >
                        <span>지문</span>
                        <strong>교과서·부교재·모의고사</strong>
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>
                    <div className="learning-section-heading">
                      <h3>최근 숙제·시험</h3>
                      <span>{selectedStudentHistory.length}개</span>
                    </div>
                    <StudentLearningActivityList
                      initialLimit={5}
                      items={selectedStudentHistory}
                    />
                  </>
                ) : (
                  <div className="student-learning-subview">
                    <div className="student-learning-subview-heading">
                      <button
                        aria-label="학습 관리로 돌아가기"
                        className="button button-quiet button-icon"
                        onClick={() => setLearningView("summary")}
                        type="button"
                      >
                        ←
                      </button>
                      <div>
                        <h3>
                          {learningView === "vocab"
                            ? "단어 학습 관리"
                            : "지문 학습 관리"}
                        </h3>
                        <p>{selectedStudent.displayName}</p>
                      </div>
                    </div>
                    {learningView === "vocab" ? (
                      <>
                        <div className="student-inline-assignment-action">
                          <div>
                            <strong>다음 단어 시험</strong>
                            <span>
                              현재 단어장과 추천 범위를 불러와 이 창에서 바로
                              배정합니다.
                            </span>
                          </div>
                          <button
                            className="button button-primary"
                            disabled={assignmentDatasets.length === 0}
                            onClick={() =>
                              setAssignmentStudentId(selectedStudent.id)
                            }
                            type="button"
                          >
                            배정하기
                          </button>
                        </div>
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
                      </>
                    ) : (
                      <div className="empty-state">
                        교과서·부교재·모의고사 범위 계약이 확정되면 이곳에서
                        지문 학습을 배정합니다.
                      </div>
                    )}
                  </div>
                )}
              </section>
            ) : activeTab === "account" ? (
              <section
                aria-labelledby="student-account-tab"
                className="student-dialog-panel"
                id="student-account-panel"
                role="tabpanel"
              >
                <form
                  className="student-profile-form"
                  onSubmit={saveStudentProfile}
                >
                  <div className="form-grid-2">
                    <label className="field">
                      <span className="field-label">이름</span>
                      <input
                        maxLength={80}
                        onChange={(event) =>
                          setProfileDisplayName(event.target.value)
                        }
                        required
                        value={profileDisplayName}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">학교</span>
                      <input
                        maxLength={120}
                        onChange={(event) =>
                          setProfileSchoolName(event.target.value)
                        }
                        value={profileSchoolName}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">학년</span>
                      <input
                        maxLength={40}
                        onChange={(event) =>
                          setProfileGradeLabel(event.target.value)
                        }
                        value={profileGradeLabel}
                      />
                    </label>
                  </div>
                  <button
                    className="button button-secondary"
                    disabled={
                      interactionBusy ||
                      !profileDisplayName.trim() ||
                      (profileDisplayName === selectedStudent.displayName &&
                        profileSchoolName ===
                          (selectedStudent.schoolName ?? "") &&
                        profileGradeLabel ===
                          (selectedStudent.gradeLabel ?? ""))
                    }
                    type="submit"
                  >
                    {busyKey === `profile:${selectedStudent.id}`
                      ? "저장 중…"
                      : "학생 정보 저장"}
                  </button>
                </form>
                <div className="student-management-summary">
                  <div>
                    <span>계정 상태</span>
                    <strong>{selectedStudent.displayName}</strong>
                  </div>
                  <span
                    className={`status-pill status-${selectedStudent.status}`}
                  >
                    {selectedStudent.status === "active"
                      ? "접속 가능"
                      : "차단됨"}
                  </span>
                </div>
                <div className="dialog-actions account-actions">
                  {selectedStudent.status === "active" ? (
                    <>
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
            ) : (
              <section
                aria-labelledby="student-history-tab"
                className="student-dialog-panel"
                id="student-history-panel"
                role="tabpanel"
              >
                <StudentLearningActivityList
                  initialLimit={5}
                  items={selectedStudentHistory}
                />
              </section>
            )}
          </div>
        </dialog>
      )}

      {assignmentStudentId ? (
        <AssignmentManager
          currentVocabWrongSummaries={currentVocabWrongSummaries}
          datasets={assignmentDatasets}
          history={history}
          initialDialogView="assign"
          initialStudentId={assignmentStudentId}
          key={assignmentStudentId}
          launcherOnly
          onLauncherClose={() => setAssignmentStudentId("")}
          pendingReviewSummaries={pendingReviewSummaries}
          progress={progress}
          students={students}
          units={assignmentUnits}
        />
      ) : null}

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
