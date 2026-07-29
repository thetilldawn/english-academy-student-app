"use client";

import { useMemo, useState, type FormEvent } from "react";
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

type AssignmentItem = {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  datasetId: string;
  datasetTitle: string;
  unitLabels: string[];
  rangeStart: number;
  rangeEnd: number;
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  passingScore: number;
  questionOrderMode: "fixed" | "random";
  studentCount: number;
};

type ProgressItem = {
  studentId: string;
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestStatus: "in_progress" | "completed" | "expired" | null;
  latestScore: number | null;
  latestPassed: boolean | null;
  latestUnitLabel: string | null;
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitLabel: string | null;
  recommendationReason:
    | "first"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
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
  if (labels.length === 0) return "기존 행 범위";
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels.at(-1)}`;
}

export function AssignmentManager({
  datasets,
  students,
  assignments,
  units,
  progress,
  initialStudentId = "",
}: {
  datasets: DatasetItem[];
  students: StudentItem[];
  assignments: AssignmentItem[];
  units: UnitItem[];
  progress: ProgressItem[];
  initialStudentId?: string;
}) {
  const router = useRouter();
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
  const initialStudent =
    activeStudents.find((student) => student.id === initialStudentId) ??
    null;
  const initialDatasetId =
    initialStudent?.currentVocabDatasetId ??
    readyDatasets[0]?.id ??
    "";
  const initialProgress =
    progress.find((item) => item.studentId === initialStudent?.id) ??
    null;
  const initialRecommendedUnitId =
    initialProgress?.recommendedDatasetId === initialDatasetId
      ? (initialProgress.recommendedUnitId ?? "")
      : "";

  const [studentId, setStudentId] = useState(initialStudent?.id ?? "");
  const [datasetId, setDatasetId] = useState(initialDatasetId);
  const [startUnitId, setStartUnitId] = useState(
    initialRecommendedUnitId,
  );
  const [endUnitId, setEndUnitId] = useState(
    initialRecommendedUnitId,
  );
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

  const selectedStudent =
    activeStudents.find((student) => student.id === studentId) ?? null;
  const selectedProgress =
    progress.find((item) => item.studentId === studentId) ?? null;
  const selectedDataset =
    readyDatasets.find((dataset) => dataset.id === datasetId) ?? null;
  const datasetUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.datasetId === datasetId)
        .sort((left, right) => left.sortIndex - right.sortIndex),
    [datasetId, units],
  );
  const effectiveStartUnitId = startUnitId || datasetUnits[0]?.id || "";
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
  const cannotCreate =
    !studentId ||
    !datasetId ||
    selectedUnits.length === 0 ||
    questionCount < 4 ||
    questionCount > availableWordCount ||
    submitting;

  function selectStudent(nextStudentId: string) {
    setStudentId(nextStudentId);
    const student = activeStudents.find(
      (candidate) => candidate.id === nextStudentId,
    );
    const nextDatasetId =
      student?.currentVocabDatasetId ||
      datasetId ||
      readyDatasets[0]?.id ||
      "";
    const nextProgress = progress.find(
      (item) => item.studentId === nextStudentId,
    );
    const nextRecommendedUnitId =
      nextProgress?.recommendedDatasetId === nextDatasetId
        ? (nextProgress.recommendedUnitId ?? "")
        : "";
    setDatasetId(nextDatasetId);
    setStartUnitId(nextRecommendedUnitId);
    setEndUnitId(nextRecommendedUnitId);
  }

  function selectDataset(nextDatasetId: string) {
    setDatasetId(nextDatasetId);
    const nextRecommendedUnitId =
      selectedProgress?.recommendedDatasetId === nextDatasetId
        ? (selectedProgress.recommendedUnitId ?? "")
        : "";
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

  function selectEndUnit(nextEndId: string) {
    setEndUnitId(nextEndId);
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
          timeLimitSeconds: timeLimitMinutes * 60,
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

      setSuccess(`${selectedStudent?.displayName ?? "학생"}에게 배정했습니다.`);
      setCustomTitle("");
      router.refresh();
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
    <div className="assignment-workspace">
      <section className="card assignment-builder">
        <div className="section-heading">
          <div>
            <h2>새 단어 시험 배정</h2>
            <p className="list-meta">
              학생을 먼저 고르고, 이어서 볼 DAY를 지정합니다.
            </p>
          </div>
          <span className="detail-chip">학생 중심 4단계</span>
        </div>

        {readyDatasets.length === 0 && (
          <div className="notice notice-warm">
            검수 완료된 단어장이 필요합니다.
          </div>
        )}
        {activeStudents.length === 0 && (
          <div className="notice notice-warm">
            접속 가능한 학생을 먼저 등록해주세요.
          </div>
        )}

        <form
          className="form-stack section assignment-form"
          onSubmit={submitAssignment}
        >
          <section className="assignment-step">
            <div className="assignment-step-heading">
              <span>1</span>
              <div>
                <h3>학생</h3>
                <p>이번 시험을 볼 학생 한 명을 먼저 선택합니다.</p>
              </div>
            </div>
            <label className="field">
              <span className="field-label">학생 선택</span>
              <select
                onChange={(event) => selectStudent(event.target.value)}
                required
                value={studentId}
              >
                <option disabled value="">
                  학생 선택
                </option>
                {activeStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.displayName}
                    {student.schoolName ? ` · ${student.schoolName}` : ""}
                    {student.gradeLabel ? ` · ${student.gradeLabel}` : ""}
                  </option>
                ))}
              </select>
              <span className="field-help">
                현재 단어장 ·{" "}
                {selectedStudent?.currentVocabBook ?? "미선택"}
                {selectedProgress?.recommendationReason === "complete"
                  ? " · 현재 단어장 진도 완료"
                  : selectedProgress?.recommendedUnitLabel
                    ? ` · 추천 ${selectedProgress.recommendedUnitLabel}`
                    : ""}
              </span>
            </label>
          </section>

          <section className="assignment-step">
            <div className="assignment-step-heading">
              <span>2</span>
              <div>
                <h3>단어장과 DAY</h3>
                <p>행 번호 대신 학생이 실제로 외우는 DAY로 정합니다.</p>
              </div>
            </div>
            <label className="field">
              <span className="field-label">단어장</span>
              <select
                onChange={(event) => selectDataset(event.target.value)}
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
                  onChange={(event) => selectStartUnit(event.target.value)}
                  required
                  value={effectiveStartUnitId}
                >
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
                  onChange={(event) => selectEndUnit(event.target.value)}
                  required
                  value={effectiveEndUnitId}
                >
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
              선택 범위 {unitRangeLabel(selectedUnitLabels)} · 원본{" "}
              {availableWordCount.toLocaleString()}개
            </p>
          </section>

          <section className="assignment-step">
            <div className="assignment-step-heading">
              <span>3</span>
              <div>
                <h3>문제 조건</h3>
                <p>문제은행은 여기서 한 번 확정되고 순서만 달라집니다.</p>
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
                  <option disabled>영영풀이 → 단어 · 자료 준비 필요</option>
                  <option disabled>예문 → 단어 · 자료 준비 필요</option>
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
                  문제와 보기는 같고 학생별 문항 순서만 정해집니다.
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
                <span className="field-label">전체 제한 시간(분)</span>
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
              <span>4</span>
              <div>
                <h3>확인하고 배정</h3>
                <p>시험 이름은 자동으로 만들어지며 필요할 때만 바꿉니다.</p>
              </div>
            </div>
            <label className="field">
              <span className="field-label">시험 이름 변경 · 선택</span>
              <input
                maxLength={160}
                onChange={(event) => setCustomTitle(event.target.value)}
                placeholder={generatedTitle || "자동 시험 이름"}
                value={customTitle}
              />
            </label>
            <div className="assignment-review-summary">
              <strong>{finalTitle || "시험 범위를 선택해주세요."}</strong>
              <dl>
                <div>
                  <dt>학생</dt>
                  <dd>{selectedStudent?.displayName ?? "—"}</dd>
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
              {submitting ? "문제은행 만드는 중…" : "이 학생에게 배정"}
            </button>
          </section>
        </form>
      </section>

      <section className="assignment-history">
        <div className="section-heading">
          <h2>배정 기록</h2>
          <span className="detail-chip">{assignments.length}건</span>
        </div>
        {assignments.length === 0 ? (
          <div className="empty-state">아직 배정된 시험이 없습니다.</div>
        ) : (
          <div className="assignment-history-grid">
            {assignments.map((assignment) => (
              <article className="card assignment-card" key={assignment.id}>
                <div className="title-with-status">
                  <div>
                    <p className="eyebrow">{assignment.datasetTitle}</p>
                    <h3>{assignment.title}</h3>
                  </div>
                  <span
                    className={`status-pill status-${assignment.status}`}
                  >
                    {assignment.status === "active"
                      ? "응시 가능"
                      : assignment.status === "draft"
                        ? "준비 중"
                        : "종료"}
                  </span>
                </div>
                <div className="assignment-details">
                  <span className="detail-chip">
                    {unitRangeLabel(assignment.unitLabels)}
                  </span>
                  <span className="detail-chip">
                    {assignment.questionCount}문항
                  </span>
                  <span className="detail-chip">
                    {directionLabel(assignment.englishToKoreanRatio)}
                  </span>
                  <span className="detail-chip">
                    {assignment.questionOrderMode === "random"
                      ? "무작위"
                      : "DAY 순서"}
                  </span>
                  <span className="detail-chip">
                    {Math.ceil(assignment.timeLimitSeconds / 60)}분
                  </span>
                  <span className="detail-chip">
                    {assignment.passingScore}점 통과
                  </span>
                  <span className="detail-chip">
                    {assignment.studentCount}명
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
