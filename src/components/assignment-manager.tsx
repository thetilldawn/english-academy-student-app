"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";

type DatasetItem = {
  id: string;
  title: string;
  edition: string | null;
  rowCount: number;
  status: "pending_review" | "ready" | "retired";
  isActive: boolean;
};

type StudentItem = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  status: "active" | "blocked";
};

type UnitItem = {
  id: string;
  datasetId: string;
  label: string;
  kind: "day" | "supplement";
  number: number | null;
  sortIndex: number;
  entryCount: number;
};

type ProgressItem = {
  studentId: string;
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestStatus:
    | "not_started"
    | "in_progress"
    | "completed"
    | "expired"
    | null;
  latestScore: number | null;
  latestInitialScore: number | null;
  latestFinalScore: number | null;
  latestPassed: boolean | null;
  latestUnitLabel: string | null;
  latestAttemptNumber: number | null;
  latestStartedAt: string | null;
  latestCompletedAt: string | null;
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitLabel: string | null;
  recommendationReason:
    | "assigned"
    | "first"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | "manual"
    | null;
};

type ErrorResponse = {
  error?: string;
};

function directionLabel(ratio: number) {
  if (ratio === 100) return "영어 → 뜻";
  if (ratio === 0) return "뜻 → 영어";
  return "영어 ↔ 뜻 혼합";
}

function unitRangeLabel(labels: string[]) {
  if (labels.length === 0) return "범위 미선택";
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels.at(-1)}`;
}

function statusLabel(status: ProgressItem["latestStatus"]) {
  if (status === "not_started") return "미응시";
  if (status === "in_progress") return "응시 중";
  if (status === "completed") return "완료";
  if (status === "expired") return "시간 종료";
  return "시험 기록 없음";
}

function scoreLabel(score: number | null | undefined) {
  return score === null || score === undefined ? "-" : `${score}점`;
}

function recommendationLabel(progress: ProgressItem | null) {
  if (!progress) return "단어장 선택 필요";
  if (progress.recommendationReason === "complete") {
    return "현재 단어장 완료";
  }
  if (progress.recommendationReason === "assigned") {
    return `${progress.recommendedUnitLabel ?? "배정 범위"} 미응시`;
  }
  if (progress.recommendationReason === "resume") {
    return `${progress.recommendedUnitLabel ?? "최근 범위"} 이어서`;
  }
  if (progress.recommendationReason === "repeat") {
    return `${progress.recommendedUnitLabel ?? "최근 범위"} 다시 배정`;
  }
  if (progress.recommendationReason === "manual") {
    return "과거 시험의 DAY 범위 직접 확인";
  }
  return progress.recommendedUnitLabel ?? "첫 DAY 선택";
}

export function AssignmentManager({
  datasets,
  students,
  units,
  progress,
  initialStudentId = "",
}: {
  datasets: DatasetItem[];
  students: StudentItem[];
  units: UnitItem[];
  progress: ProgressItem[];
  initialStudentId?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const readyDatasets = useMemo(
    () =>
      datasets.filter(
        (dataset) => dataset.status === "ready" && dataset.isActive,
      ),
    [datasets],
  );
  const activeStudents = useMemo(
    () => students.filter((student) => student.status === "active"),
    [students],
  );
  const progressByStudent = useMemo(
    () => new Map(progress.map((item) => [item.studentId, item])),
    [progress],
  );
  const initialStudent =
    activeStudents.find((student) => student.id === initialStudentId) ??
    null;
  const initialStudentDatasetId = readyDatasets.some(
    (dataset) => dataset.id === initialStudent?.currentVocabDatasetId,
  )
    ? initialStudent?.currentVocabDatasetId
    : null;
  const initialDatasetId =
    initialStudentDatasetId ?? readyDatasets[0]?.id ?? "";
  const initialProgress = initialStudent
    ? (progressByStudent.get(initialStudent.id) ?? null)
    : null;
  const initialRecommendedUnitId =
    initialProgress?.recommendedDatasetId === initialDatasetId
      ? (initialProgress.recommendedUnitId ?? "")
      : "";

  const [testTab, setTestTab] = useState<"vocab" | "other">("vocab");
  const [query, setQuery] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [studentId, setStudentId] = useState(initialStudent?.id ?? "");
  const [datasetId, setDatasetId] = useState(initialDatasetId);
  const [startUnitId, setStartUnitId] = useState(initialRecommendedUnitId);
  const [endUnitId, setEndUnitId] = useState(initialRecommendedUnitId);
  const [questionCount, setQuestionCount] = useState(20);
  const [directionRatio, setDirectionRatio] = useState<0 | 50 | 100>(50);
  const [questionOrderMode, setQuestionOrderMode] = useState<
    "fixed" | "random"
  >("random");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(5);
  const [passingScore, setPassingScore] = useState(80);
  const [customTitle, setCustomTitle] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshPending, startRefreshTransition] = useTransition();

  const selectedStudent =
    activeStudents.find((student) => student.id === studentId) ?? null;
  const selectedProgress = selectedStudent
    ? (progressByStudent.get(selectedStudent.id) ?? null)
    : null;
  const selectedDataset =
    readyDatasets.find((dataset) => dataset.id === datasetId) ?? null;
  const datasetUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.datasetId === datasetId)
        .toSorted((left, right) => left.sortIndex - right.sortIndex),
    [datasetId, units],
  );
  const needsManualUnitSelection =
    selectedProgress?.recommendationReason === "manual" &&
    selectedProgress.recommendedDatasetId === datasetId;
  const effectiveStartUnitId =
    startUnitId ||
    (needsManualUnitSelection ? "" : datasetUnits[0]?.id) ||
    "";
  const effectiveEndUnitId =
    endUnitId || effectiveStartUnitId || datasetUnits[0]?.id || "";
  const startIndex = datasetUnits.findIndex(
    (unit) => unit.id === effectiveStartUnitId,
  );
  const endIndex = datasetUnits.findIndex(
    (unit) => unit.id === effectiveEndUnitId,
  );
  const selectedUnits =
    startIndex < 0 || endIndex < startIndex
      ? []
      : datasetUnits.slice(startIndex, endIndex + 1);
  const availableWordCount = selectedUnits.reduce(
    (total, unit) => total + unit.entryCount,
    0,
  );
  const selectedUnitLabels = selectedUnits.map((unit) => unit.label);
  const generatedTitle = [
    selectedDataset?.title,
    selectedDataset?.edition,
    unitRangeLabel(selectedUnitLabels),
  ]
    .filter(Boolean)
    .join(" · ");
  const finalTitle = customTitle.trim() || generatedTitle;
  const timeLimitSeconds = timeLimitMinutes * 60;
  const cannotCreate =
    !studentId ||
    !datasetId ||
    !selectedDataset ||
    selectedUnits.length === 0 ||
    questionCount < 4 ||
    questionCount > availableWordCount ||
    timeLimitSeconds < 30 ||
    timeLimitSeconds > 10800 ||
    submitting ||
    refreshPending;

  const schoolOptions = useMemo(
    () =>
      Array.from(
        new Set(
          activeStudents
            .map((student) => student.schoolName?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [activeStudents],
  );
  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          activeStudents
            .map((student) => student.gradeLabel?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).toSorted(),
    [activeStudents],
  );
  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    return activeStudents.filter((student) => {
      const searchText = [
        student.displayName,
        student.schoolName,
        student.gradeLabel,
        student.currentVocabBook,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      return (
        (!keyword || searchText.includes(keyword)) &&
        (!schoolFilter || student.schoolName === schoolFilter) &&
        (!gradeFilter || student.gradeLabel === gradeFilter)
      );
    });
  }, [activeStudents, gradeFilter, query, schoolFilter]);

  useEffect(() => {
    if (selectedStudent && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [selectedStudent]);

  function selectStudent(nextStudentId: string) {
    const student = activeStudents.find(
      (candidate) => candidate.id === nextStudentId,
    );
    const currentDatasetIsReady = readyDatasets.some(
      (dataset) => dataset.id === student?.currentVocabDatasetId,
    );
    const nextDatasetId =
      (currentDatasetIsReady
        ? student?.currentVocabDatasetId
        : null) ??
      readyDatasets[0]?.id ??
      "";
    const nextProgress = progressByStudent.get(nextStudentId) ?? null;
    const nextRecommendedUnitId =
      nextProgress?.recommendedDatasetId === nextDatasetId
        ? (nextProgress.recommendedUnitId ?? "")
        : "";

    setStudentId(nextStudentId);
    setDatasetId(nextDatasetId);
    setStartUnitId(nextRecommendedUnitId);
    setEndUnitId(nextRecommendedUnitId);
    setCustomTitle("");
    setError("");
    setSuccess("");
  }

  function selectDataset(nextDatasetId: string) {
    const nextRecommendedUnitId =
      selectedProgress?.recommendedDatasetId === nextDatasetId
        ? (selectedProgress.recommendedUnitId ?? "")
        : "";
    setDatasetId(nextDatasetId);
    setStartUnitId(nextRecommendedUnitId);
    setEndUnitId(nextRecommendedUnitId);
  }

  function selectStartUnit(nextStartId: string) {
    setStartUnitId(nextStartId);
    const nextStartIndex = datasetUnits.findIndex(
      (unit) => unit.id === nextStartId,
    );
    const currentEndIndex = datasetUnits.findIndex(
      (unit) => unit.id === effectiveEndUnitId,
    );
    if (currentEndIndex < nextStartIndex) {
      setEndUnitId(nextStartId);
    }
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function closeDialogOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeDialog();
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: customTitle,
          datasetId,
          unitIds: selectedUnits.map((unit) => unit.id),
          questionCount,
          englishToKoreanRatio: directionRatio,
          timeLimitSeconds,
          passingScore,
          questionOrderMode,
          studentIds: [studentId],
        }),
      });
      const payload = (await response.json()) as ErrorResponse;

      if (!response.ok) {
        throw new Error(
          payload.error ?? "단어 시험을 배정하지 못했습니다.",
        );
      }

      setSuccess(
        `${selectedStudent?.displayName ?? "학생"}에게 배정했습니다.`,
      );
      setCustomTitle("");
      startRefreshTransition(() => router.refresh());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "단어 시험을 배정하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        aria-label="시험 종류"
        className="management-tabs"
      >
        <button
          aria-pressed={testTab === "vocab"}
          className="management-tab"
          onClick={() => setTestTab("vocab")}
          type="button"
        >
          단어 시험
        </button>
        <button
          aria-pressed={testTab === "other"}
          className="management-tab"
          onClick={() => setTestTab("other")}
          type="button"
        >
          다른 시험
        </button>
      </div>

      {testTab === "other" ? (
        <section className="empty-state test-type-placeholder">
          다른 유형의 시험은 워크북 문제 구조가 확정되면 이 탭에
          추가합니다.
        </section>
      ) : (
        <section className="assignment-student-browser">
          <div className="manager-toolbar">
            <div>
              <h2>단어 시험 배정</h2>
              <p className="list-meta">
                학생을 찾은 뒤 최근 범위와 다음 DAY를 확인하고
                배정합니다.
              </p>
            </div>
            <span className="detail-chip">
              {filteredStudents.length}명
            </span>
          </div>

          <div className="card assignment-student-filters">
            <label className="field assignment-search-field">
              <span className="field-label">학생 검색</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름·학교·학년·단어장"
                type="search"
                value={query}
              />
            </label>
            <label className="field">
              <span className="field-label">학교</span>
              <select
                onChange={(event) => setSchoolFilter(event.target.value)}
                value={schoolFilter}
              >
                <option value="">전체 학교</option>
                {schoolOptions.map((school) => (
                  <option key={school} value={school}>
                    {school}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">학년</span>
              <select
                onChange={(event) => setGradeFilter(event.target.value)}
                value={gradeFilter}
              >
                <option value="">전체 학년</option>
                {gradeOptions.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {readyDatasets.length === 0 && (
            <div className="notice notice-warm">
              검수가 끝난 단어장이 없어 아직 시험을 배정할 수
              없습니다.
            </div>
          )}

          {filteredStudents.length === 0 ? (
            <div className="empty-state">
              조건에 맞는 접속 가능 학생이 없습니다.
            </div>
          ) : (
            <div className="assignment-student-list">
              {filteredStudents.map((student) => {
                const studentProgress =
                  progressByStudent.get(student.id) ?? null;
                return (
                  <button
                    className="card assignment-student-row"
                    key={student.id}
                    onClick={() => selectStudent(student.id)}
                    type="button"
                  >
                    <span className="assignment-student-identity">
                      <strong>{student.displayName}</strong>
                      <span>
                        {[student.schoolName, student.gradeLabel]
                          .filter(Boolean)
                          .join(" · ") || "학교·학년 미입력"}
                      </span>
                    </span>
                    <span className="assignment-student-book">
                      <small>현재 단어장</small>
                      <strong>
                        {student.currentVocabBook ?? "미선택"}
                      </strong>
                    </span>
                    <span className="assignment-student-recent">
                      <small>최근 시험</small>
                      <strong>
                        {studentProgress?.latestAssignmentTitle ??
                          "기록 없음"}
                      </strong>
                      <span>
                        {statusLabel(
                          studentProgress?.latestStatus ?? null,
                        )}
                        {" · "}첫{" "}
                        {scoreLabel(
                          studentProgress?.latestInitialScore,
                        )}
                        {" · "}최종{" "}
                        {scoreLabel(
                          studentProgress?.latestFinalScore,
                        )}
                      </span>
                    </span>
                    <span className="assignment-student-next">
                      <small>다음 배정</small>
                      <strong>
                        {recommendationLabel(studentProgress)}
                      </strong>
                    </span>
                    <span className="button button-primary button-small">
                      배정
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {selectedStudent && (
        <dialog
          aria-labelledby="assignment-dialog-title"
          className="dialog dialog-extra-wide assignment-dialog"
          onClick={closeDialogOnBackdrop}
          onClose={() => setStudentId("")}
          ref={dialogRef}
        >
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">단어 시험 배정</p>
              <h2 id="assignment-dialog-title">
                {selectedStudent.displayName}
              </h2>
              <p>
                {[
                  selectedStudent.schoolName,
                  selectedStudent.gradeLabel,
                  selectedStudent.currentVocabBook,
                ]
                  .filter(Boolean)
                  .join(" · ") || "학생 정보 미입력"}
              </p>
            </div>
            <button
              aria-label="닫기"
              className="button button-quiet button-small"
              onClick={closeDialog}
              type="button"
            >
              닫기
            </button>
          </div>

          <div className="assignment-dialog-context">
            <span>
              최근 시험 ·{" "}
              {selectedProgress?.latestAssignmentTitle ?? "기록 없음"}
            </span>
            <span>
              {statusLabel(selectedProgress?.latestStatus ?? null)}
              {" · "}첫{" "}
              {scoreLabel(selectedProgress?.latestInitialScore)}
              {" · "}최종{" "}
              {scoreLabel(selectedProgress?.latestFinalScore)}
            </span>
            <strong>
              추천 · {recommendationLabel(selectedProgress)}
            </strong>
          </div>

          <form
            aria-busy={submitting}
            className="assignment-modal-form"
            onSubmit={submitAssignment}
          >
            <section className="assignment-step">
              <div className="assignment-step-heading">
                <span>1</span>
                <div>
                  <h3>단어장과 DAY</h3>
                  <p>학생이 실제로 외울 DAY 범위를 정합니다.</p>
                </div>
              </div>
              <label className="field">
                <span className="field-label">단어장</span>
                <select
                  onChange={(event) =>
                    selectDataset(event.target.value)
                  }
                  required
                  value={datasetId}
                >
                  <option disabled value="">
                    단어장 선택
                  </option>
                  {readyDatasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {[dataset.title, dataset.edition]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid-2">
                <label className="field">
                  <span className="field-label">시작 DAY</span>
                  <select
                    onChange={(event) =>
                      selectStartUnit(event.target.value)
                    }
                    required
                    value={effectiveStartUnitId}
                  >
                    <option disabled value="">
                      시작 DAY 선택
                    </option>
                    {datasetUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label} · {unit.entryCount}개
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">끝 DAY</span>
                  <select
                    onChange={(event) =>
                      setEndUnitId(event.target.value)
                    }
                    required
                    value={effectiveEndUnitId}
                  >
                    <option disabled value="">
                      끝 DAY 선택
                    </option>
                    {datasetUnits.map((unit, index) => (
                      <option
                        disabled={index < Math.max(startIndex, 0)}
                        key={unit.id}
                        value={unit.id}
                      >
                        {unit.label} · {unit.entryCount}개
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="selection-summary">
                {unitRangeLabel(selectedUnitLabels)} · 원본{" "}
                {availableWordCount.toLocaleString()}개
              </p>
            </section>

            <section className="assignment-step">
              <div className="assignment-step-heading">
                <span>2</span>
                <div>
                  <h3>문제 조건</h3>
                  <p>방향·순서·시간과 통과 기준을 정합니다.</p>
                </div>
              </div>
              <div className="form-grid-2">
                <label className="field">
                  <span className="field-label">출제 방식</span>
                  <select
                    onChange={(event) =>
                      setDirectionRatio(
                        Number(event.target.value) as 0 | 50 | 100,
                      )
                    }
                    value={directionRatio}
                  >
                    <option value={100}>영어 → 뜻</option>
                    <option value={0}>뜻 → 영어</option>
                    <option value={50}>영어 ↔ 뜻 혼합</option>
                    <option disabled>
                      영영풀이 → 영어 · 자료 준비 필요
                    </option>
                    <option disabled>
                      예문 → 영어 · 자료 준비 필요
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">문제 순서</span>
                  <select
                    onChange={(event) =>
                      setQuestionOrderMode(
                        event.target.value as "fixed" | "random",
                      )
                    }
                    value={questionOrderMode}
                  >
                    <option value="random">무작위</option>
                    <option value="fixed">DAY 순서</option>
                  </select>
                  <span className="field-help">
                    문제와 보기는 미리 만들고 학생별 문항 순서만
                    바뀝니다.
                  </span>
                </label>
              </div>
              <div className="form-grid-3">
                <label className="field">
                  <span className="field-label">문항 수</span>
                  <input
                    max={Math.min(availableWordCount || 500, 500)}
                    min={4}
                    onChange={(event) =>
                      setQuestionCount(Number(event.target.value))
                    }
                    required
                    type="number"
                    value={questionCount}
                  />
                </label>
                <label className="field">
                  <span className="field-label">전체 시험 시간(분)</span>
                  <input
                    max={180}
                    min={1}
                    onChange={(event) =>
                      setTimeLimitMinutes(Number(event.target.value))
                    }
                    required
                    type="number"
                    value={timeLimitMinutes}
                  />
                </label>
                <label className="field">
                  <span className="field-label">통과 점수</span>
                  <input
                    max={100}
                    min={0}
                    onChange={(event) =>
                      setPassingScore(Number(event.target.value))
                    }
                    required
                    type="number"
                    value={passingScore}
                  />
                </label>
              </div>
            </section>

            <section className="assignment-step assignment-review-step">
              <div className="assignment-step-heading">
                <span>3</span>
                <div>
                  <h3>확인하고 배정</h3>
                  <p>시험 이름은 자동 생성하며 필요할 때만 바꿉니다.</p>
                </div>
              </div>
              <label className="field">
                <span className="field-label">
                  시험 이름 변경 · 선택
                </span>
                <input
                  maxLength={160}
                  onChange={(event) =>
                    setCustomTitle(event.target.value)
                  }
                  placeholder={generatedTitle || "자동 시험 이름"}
                  value={customTitle}
                />
              </label>
              <div className="assignment-review-summary">
                <strong>
                  {finalTitle || "시험 범위를 선택해주세요."}
                </strong>
                <dl>
                  <div>
                    <dt>학생</dt>
                    <dd>{selectedStudent.displayName}</dd>
                  </div>
                  <div>
                    <dt>범위</dt>
                    <dd>{unitRangeLabel(selectedUnitLabels)}</dd>
                  </div>
                  <div>
                    <dt>출제</dt>
                    <dd>{directionLabel(directionRatio)}</dd>
                  </div>
                  <div>
                    <dt>순서</dt>
                    <dd>
                      {questionOrderMode === "random"
                        ? "무작위"
                        : "DAY 순서"}
                    </dd>
                  </div>
                  <div>
                    <dt>조건</dt>
                    <dd>
                      {questionCount}문항 · {timeLimitMinutes}분 ·{" "}
                      {passingScore}점
                    </dd>
                  </div>
                </dl>
              </div>
              {questionCount > availableWordCount && (
                <div className="notice notice-error" role="alert">
                  선택 범위의 단어 수보다 문항 수가 많습니다.
                </div>
              )}
              {(timeLimitSeconds < 30 ||
                timeLimitSeconds > 10800) && (
                <div className="notice notice-error" role="alert">
                  계산된 전체 시험 시간은 30초 이상 180분 이하여야
                  합니다.
                </div>
              )}
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
              {success && (
                <div className="notice notice-success" role="status">
                  {success}
                </div>
              )}
              <button
                className="button button-primary button-large"
                disabled={cannotCreate}
                type="submit"
              >
                {submitting
                  ? "배정하는 중…"
                  : refreshPending
                    ? "화면에 반영하는 중…"
                    : "이 학생에게 배정"}
              </button>
            </section>
          </form>
        </dialog>
      )}
    </>
  );
}
