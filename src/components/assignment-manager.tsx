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
  status: "active" | "blocked";
};

type AssignmentItem = {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  rangeStart: number;
  rangeEnd: number;
  questionCount: number;
  timeLimitSeconds: number;
  passingScore: number;
  retakeAllowed: boolean;
  studentCount: number;
};

type ErrorResponse = {
  error?: string;
};

type AssignmentReview = {
  title: string;
  rangeStart: string;
  rangeEnd: string;
  questionCount: string;
  timeLimitMinutes: string;
  passingScore: string;
};

const INITIAL_REVIEW: AssignmentReview = {
  title: "",
  rangeStart: "1",
  rangeEnd: "50",
  questionCount: "20",
  timeLimitMinutes: "5",
  passingScore: "80",
};

export function AssignmentManager({
  datasets,
  students,
  assignments,
}: {
  datasets: DatasetItem[];
  students: StudentItem[];
  assignments: AssignmentItem[];
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
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] =
    useState<AssignmentReview>(INITIAL_REVIEW);

  function toggleStudent(studentId: string) {
    setSelectedStudents((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    try {
      const response = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          datasetId: form.get("datasetId"),
          rangeStart: form.get("rangeStart"),
          rangeEnd: form.get("rangeEnd"),
          questionCount: form.get("questionCount"),
          timeLimitSeconds:
            Number(form.get("timeLimitMinutes")) * 60,
          passingScore: form.get("passingScore"),
          retakeAllowed: form.get("retakeAllowed") === "on",
          studentIds: selectedStudents,
        }),
      });
      const payload = (await response.json()) as ErrorResponse;

      if (!response.ok) {
        throw new Error(
          payload.error ?? "시험을 배정하지 못했습니다.",
        );
      }

      setSuccess("시험을 배정했습니다.");
      setSelectedStudents([]);
      setReview(INITIAL_REVIEW);
      formElement.reset();
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "시험을 배정하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const cannotCreate =
    readyDatasets.length === 0 || activeStudents.length === 0;

  return (
    <div className="assignment-workspace">
      <section className="card assignment-builder">
        <div className="section-heading">
          <div>
            <h2>새 단어시험</h2>
            <p className="list-meta">
              범위부터 학생 선택까지 순서대로 정합니다.
            </p>
          </div>
          <span className="detail-chip">4단계</span>
        </div>

        {readyDatasets.length === 0 && (
          <div className="notice notice-warm">
            <strong>검수 완료 데이터가 필요합니다.</strong>
            <span>
              최신 능률보카 목록을 검수·가져온 뒤 시험을 만들 수
              있습니다.
            </span>
          </div>
        )}
        {activeStudents.length === 0 && (
          <div className="notice notice-warm">
            접속 가능한 학생을 먼저 등록해주세요.
          </div>
        )}

        <form
          className="form-stack section assignment-form"
          onChange={(event) => {
            const form = new FormData(event.currentTarget);
            setReview({
              title: String(form.get("title") ?? ""),
              rangeStart: String(form.get("rangeStart") ?? ""),
              rangeEnd: String(form.get("rangeEnd") ?? ""),
              questionCount: String(form.get("questionCount") ?? ""),
              timeLimitMinutes: String(
                form.get("timeLimitMinutes") ?? "",
              ),
              passingScore: String(form.get("passingScore") ?? ""),
            });
          }}
          onSubmit={submitAssignment}
        >
          <section className="assignment-step">
            <div className="assignment-step-heading">
              <span>1</span>
              <div>
                <h3>시험 범위</h3>
                <p>시험 이름과 사용할 단어 범위를 정합니다.</p>
              </div>
            </div>
            <div className="assignment-step-fields">
              <label className="field">
                <span className="field-label">시험 이름</span>
                <input
                  name="title"
                  required
                  maxLength={160}
                  placeholder="예: 능률 VOCA DAY 1~3"
                />
              </label>
              <label className="field">
                <span className="field-label">단어 목록</span>
                <select name="datasetId" required defaultValue="">
                  <option disabled value="">
                    선택
                  </option>
                  {readyDatasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.title}
                      {dataset.edition ? ` · ${dataset.edition}` : ""}
                      {` · ${dataset.rowCount.toLocaleString()}행`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid-2">
              <label className="field">
                <span className="field-label">시작 번호</span>
                <input
                  name="rangeStart"
                  type="number"
                  min={1}
                  required
                  defaultValue={1}
                />
              </label>
              <label className="field">
                <span className="field-label">끝 번호</span>
                <input
                  name="rangeEnd"
                  type="number"
                  min={1}
                  required
                  defaultValue={50}
                />
              </label>
            </div>
          </section>

          <section className="assignment-step">
            <div className="assignment-step-heading">
              <span>2</span>
              <div>
                <h3>문제 조건</h3>
                <p>문항 수, 제한시간, 통과점수를 정합니다.</p>
              </div>
            </div>
            <div className="form-grid-3">
              <label className="field">
                <span className="field-label">문항</span>
                <input
                  name="questionCount"
                  type="number"
                  min={4}
                  max={500}
                  required
                  defaultValue={20}
                />
              </label>
              <label className="field">
                <span className="field-label">제한(분)</span>
                <input
                  name="timeLimitMinutes"
                  type="number"
                  min={1}
                  max={180}
                  required
                  defaultValue={5}
                />
              </label>
              <label className="field">
                <span className="field-label">통과점수</span>
                <input
                  name="passingScore"
                  type="number"
                  min={0}
                  max={100}
                  required
                  defaultValue={80}
                />
              </label>
            </div>
            <label className="checkbox-row standalone-checkbox">
              <input name="retakeAllowed" type="checkbox" />
              <span>
                <strong>전체 재시험 허용</strong>
                <small>완료 후에도 새 시험을 다시 시작할 수 있음</small>
              </span>
            </label>
          </section>

          <section className="assignment-step">
            <div className="assignment-step-heading">
              <span>3</span>
              <div>
                <h3>응시 학생</h3>
                <p>이번 시험을 볼 학생을 선택합니다.</p>
              </div>
            </div>
            <fieldset className="field fieldset-reset">
              <legend className="field-label">학생 선택</legend>
              <div className="checkbox-list">
                {activeStudents.map((student) => (
                  <label className="checkbox-row" key={student.id}>
                    <input
                      checked={selectedStudents.includes(student.id)}
                      onChange={() => toggleStudent(student.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{student.displayName}</strong>
                      <small>
                        {[student.schoolName, student.gradeLabel]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="assignment-step assignment-review-step">
            <div className="assignment-step-heading">
              <span>4</span>
              <div>
                <h3>최종 확인</h3>
                <p>입력한 조건으로 선택 학생에게 바로 배정합니다.</p>
              </div>
            </div>
            <div className="assignment-review-summary">
              <strong>{review.title || "시험 이름 미입력"}</strong>
              <dl>
                <div>
                  <dt>범위</dt>
                  <dd>
                    {review.rangeStart || "—"}~
                    {review.rangeEnd || "—"}
                  </dd>
                </div>
                <div>
                  <dt>문항</dt>
                  <dd>{review.questionCount || "—"}문항</dd>
                </div>
                <div>
                  <dt>시간</dt>
                  <dd>{review.timeLimitMinutes || "—"}분</dd>
                </div>
                <div>
                  <dt>통과</dt>
                  <dd>{review.passingScore || "—"}점</dd>
                </div>
                <div>
                  <dt>학생</dt>
                  <dd>{selectedStudents.length}명</dd>
                </div>
              </dl>
            </div>
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
              disabled={
                cannotCreate ||
                selectedStudents.length === 0 ||
                submitting
              }
              type="submit"
            >
              {submitting ? "배정 중…" : "선택 학생에게 배정"}
            </button>
          </section>
        </form>
      </section>

      <section className="assignment-history">
        <div className="section-heading">
          <h2>배정된 시험</h2>
          <span className="detail-chip">{assignments.length}건</span>
        </div>
        {assignments.length === 0 ? (
          <div className="empty-state">
            아직 배정된 시험이 없습니다.
          </div>
        ) : (
          <div className="assignment-history-grid">
            {assignments.map((assignment) => (
              <article className="card assignment-card" key={assignment.id}>
                <div className="title-with-status">
                  <h3>{assignment.title}</h3>
                  <span
                    className={`status-pill status-${assignment.status}`}
                  >
                    {assignment.status === "active"
                      ? "응시 가능"
                      : assignment.status === "draft"
                        ? "준비중"
                        : "종료"}
                  </span>
                </div>
                <div className="assignment-details">
                  <span className="detail-chip">
                    {assignment.rangeStart}~{assignment.rangeEnd}번
                  </span>
                  <span className="detail-chip">
                    {assignment.questionCount}문항
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
                  <span className="detail-chip">
                    재시험 {assignment.retakeAllowed ? "허용" : "불가"}
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
