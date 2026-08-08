"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";

import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { HelpTip } from "@/components/help-tip";
import { Button } from "@/components/ui-button";
import { adminLearningText } from "@/content/ko/admin-learning";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import type { ReviewLevel } from "@/lib/admin/assignment-submission";
import {
  currentTimeMilliseconds,
  koreanDateTimeLocalToIso,
} from "@/lib/deadline";

type BulkPreviewItem = {
  studentId: string;
  studentName: string;
  available: boolean;
  datasetId: string | null;
  datasetLabel: string | null;
  unitId: string | null;
  unitLabel: string | null;
  questionCount: number;
  wrongCount: number;
  error: string | null;
};

type BulkPreview = {
  items: BulkPreviewItem[];
  assignableCount: number;
  blockedCount: number;
};

type ErrorResponse = { error?: string };

export function BulkAssignmentDialog({
  includePendingReview,
  students,
  onClose,
  onSuccess,
}: {
  includePendingReview: boolean;
  students: { id: string; displayName: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [directionRatio, setDirectionRatio] = useState<0 | 50 | 100>(50);
  const [reviewLevels, setReviewLevels] = useState<ReviewLevel[]>([1, 2]);
  const [questionOrderMode, setQuestionOrderMode] =
    useState<QuestionOrderMode>("random");
  const [timingMode, setTimingMode] = useState<TimingMode>("total");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(5);
  const [questionTimeLimitSeconds, setQuestionTimeLimitSeconds] =
    useState(20);
  const [passingScore, setPassingScore] = useState(80);
  const [availableUntilLocal, setAvailableUntilLocal] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const studentIdsKey = useMemo(
    () => students.map((student) => student.id).join(","),
    [students],
  );

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/bulk-assignments/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentIds: studentIdsKey.split(",").filter(Boolean),
        includePendingReview,
        reviewLevels,
        englishToKoreanRatio: directionRatio,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          | BulkPreview
          | ErrorResponse;
        if (!response.ok || !("items" in payload)) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "학생별 다음 범위를 계산하지 못했습니다.",
          );
        }
        setPreview(payload);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setPreview(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "학생별 다음 범위를 계산하지 못했습니다.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [
    directionRatio,
    includePendingReview,
    reviewLevels,
    studentIdsKey,
  ]);

  function close() {
    if (!submitting) dialogRef.current?.close();
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) close();
  }

  function cancel(event: SyntheticEvent<HTMLDialogElement>) {
    if (submitting) event.preventDefault();
  }

  function toggleReviewLevel(level: ReviewLevel) {
    setPreviewLoading(true);
    setPreview(null);
    setError("");
    setReviewLevels((current) => {
      if (current.includes(level)) {
        return current.length === 1
          ? current
          : current.filter((item) => item !== level);
      }
      return [...current, level].toSorted();
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const availableUntil = availableUntilLocal
      ? koreanDateTimeLocalToIso(availableUntilLocal)
      : null;
    if (
      availableUntilLocal &&
      (!availableUntil || Date.parse(availableUntil) <= currentTimeMilliseconds())
    ) {
      setError(adminLearningText.assignmentModal.deadline.invalid);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/bulk-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          studentIds: students.map((student) => student.id),
          includePendingReview,
          reviewLevels,
          englishToKoreanRatio: directionRatio,
          timeLimitSeconds:
            timingMode === "total" ? timeLimitMinutes * 60 : 10800,
          passingScore,
          questionOrderMode,
          availableUntil,
          timingMode,
          questionTimeLimitSeconds:
            timingMode === "per_question"
              ? questionTimeLimitSeconds
              : null,
        }),
      });
      const payload = (await response.json()) as ErrorResponse & {
        assignments?: unknown[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "일괄 배정을 저장하지 못했습니다.");
      }
      onSuccess();
      dialogRef.current?.close();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "일괄 배정을 저장하지 못했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      aria-labelledby="bulk-assignment-title"
      className="dialog dialog-extra-wide bulk-assignment-dialog"
      onCancel={cancel}
      onClick={closeOnBackdrop}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="dialog-heading learning-dialog-heading">
        <div>
          <h2 className="label-with-help" id="bulk-assignment-title">
            {includePendingReview
              ? adminLearningText.bulkAssignmentModal.withWrongTitle
              : adminLearningText.bulkAssignmentModal.nextTitle}
            <HelpTip label="자동 범위 계산 도움말">
              {adminLearningText.bulkAssignmentModal.autoRangeHelp}
            </HelpTip>
          </h2>
          <p>{students.length}명</p>
        </div>
        <Button
          aria-label={adminLearningText.bulkAssignmentModal.close}
          disabled={submitting}
          onClick={close}
          size="small"
          variant="quiet"
        >
          {adminLearningText.bulkAssignmentModal.close}
        </Button>
      </div>

      <form className="bulk-assignment-form" onSubmit={submit}>
          <section className="bulk-assignment-settings">
            <label className="field">
              <span className="field-label">출제 방식</span>
              <select
                onChange={(event) => {
                  setPreviewLoading(true);
                  setPreview(null);
                  setError("");
                  setDirectionRatio(
                    Number(event.target.value) as 0 | 50 | 100,
                  );
                }}
                value={directionRatio}
              >
                <option value={100}>영어 → 뜻</option>
                <option value={0}>뜻 → 영어</option>
                <option value={50}>영어 ↔ 뜻 혼합</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">문제 순서</span>
              <select
                onChange={(event) =>
                  setQuestionOrderMode(event.target.value as QuestionOrderMode)
                }
                value={questionOrderMode}
              >
                <option value="ascending">오름차순</option>
                <option value="descending">내림차순</option>
                <option value="random">무작위</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">통과 점수</span>
              <input
                max={100}
                min={0}
                onChange={(event) => setPassingScore(Number(event.target.value))}
                type="number"
                value={passingScore}
              />
            </label>
            <fieldset className="field timing-mode-field">
              <legend className="field-label label-with-help">
                {adminLearningText.assignmentModal.conditions.timingMode}
                <HelpTip label="시간 제한 방식 도움말">
                  {adminLearningText.assignmentModal.conditions.timingHelp}
                </HelpTip>
              </legend>
              <div className="segmented-control">
                <button
                  aria-pressed={timingMode === "total"}
                  onClick={() => setTimingMode("total")}
                  type="button"
                >
                  전체
                </button>
                <button
                  aria-pressed={timingMode === "per_question"}
                  onClick={() => setTimingMode("per_question")}
                  type="button"
                >
                  문제당
                </button>
              </div>
            </fieldset>
            <label className="field">
              <span className="field-label">
                {timingMode === "total" ? "전체 시간(분)" : "문제당 시간(초)"}
              </span>
              <input
                max={timingMode === "total" ? 180 : 600}
                min={timingMode === "total" ? 1 : 5}
                onChange={(event) =>
                  timingMode === "total"
                    ? setTimeLimitMinutes(Number(event.target.value))
                    : setQuestionTimeLimitSeconds(Number(event.target.value))
                }
                type="number"
                value={
                  timingMode === "total"
                    ? timeLimitMinutes
                    : questionTimeLimitSeconds
                }
              />
            </label>
            <div className="field">
              <span className="field-label label-with-help">
                <label htmlFor="bulk-assignment-available-until">
                  {adminLearningText.assignmentModal.deadline.label}
                </label>
                <HelpTip label="응시 마감 시간 설정 도움말">
                  {adminLearningText.bulkAssignmentModal.deadlineHelp}
                </HelpTip>
              </span>
              <input
                id="bulk-assignment-available-until"
                onChange={(event) => setAvailableUntilLocal(event.target.value)}
                type="datetime-local"
                value={availableUntilLocal}
              />
            </div>
          </section>

          {includePendingReview ? (
            <fieldset className="bulk-review-levels">
              <legend>포함할 오답</legend>
              <div className="filter-chip-row">
                <button
                  aria-pressed={reviewLevels.includes(1)}
                  className="filter-chip"
                  onClick={() => toggleReviewLevel(1)}
                  type="button"
                >
                  한 번 틀림
                </button>
                <button
                  aria-pressed={reviewLevels.includes(2)}
                  className="filter-chip"
                  onClick={() => toggleReviewLevel(2)}
                  type="button"
                >
                  두 번 이상 틀림
                </button>
              </div>
            </fieldset>
          ) : null}

          <section className="bulk-preview-section" aria-busy={previewLoading}>
            <div className="learning-section-heading">
              <h3 className="label-with-help">
                {adminLearningText.bulkAssignmentModal.previewTitle}
                <HelpTip label="일괄 배정 저장 방식 도움말">
                  {adminLearningText.bulkAssignmentModal.atomicHelp}
                </HelpTip>
              </h3>
              <span>
                {previewLoading
                  ? "계산 중"
                  : `${preview?.assignableCount ?? 0}명 가능 · ${preview?.blockedCount ?? 0}명 확인 필요`}
              </span>
            </div>
            <div className="bulk-preview-list">
              {(preview?.items ?? students.map((student) => ({
                studentId: student.id,
                studentName: student.displayName,
                available: false,
                datasetId: null,
                datasetLabel: null,
                unitId: null,
                unitLabel: null,
                questionCount: 0,
                wrongCount: 0,
                error: null,
              }))).map((item) => (
                <article className="bulk-preview-row" key={item.studentId}>
                  <strong>{item.studentName}</strong>
                  <MetaTagList>
                    <MetaTag>{item.datasetLabel ?? "단어장 확인 중"}</MetaTag>
                    <MetaTag>{item.unitLabel ?? "범위 확인 중"}</MetaTag>
                    {item.available ? (
                      <MetaTag tone="positive">{item.questionCount}문항</MetaTag>
                    ) : (
                      <MetaTag tone="danger">확인 필요</MetaTag>
                    )}
                    {includePendingReview && item.wrongCount > 0 ? (
                      <MetaTag tone="warning">오답 {item.wrongCount}개</MetaTag>
                    ) : null}
                  </MetaTagList>
                  {item.error ? <small>{item.error}</small> : null}
                </article>
              ))}
            </div>
          </section>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="dialog-actions">
            <Button
              disabled={submitting}
              onClick={close}
              variant="quiet"
            >
              {adminLearningText.bulkAssignmentModal.cancel}
            </Button>
            <Button
              disabled={
                submitting ||
                previewLoading ||
                !preview ||
                preview.blockedCount > 0 ||
                preview.assignableCount !== students.length
              }
              type="submit"
              variant="primary"
            >
              {submitting ? "전체 저장 중…" : `${students.length}명에게 배정`}
            </Button>
          </div>
      </form>
    </dialog>
  );
}
