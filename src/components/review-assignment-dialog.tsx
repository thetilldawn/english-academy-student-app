"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";

import { HelpTip } from "@/components/help-tip";
import { adminLearningText } from "@/content/ko/admin-learning";
import type { ReviewAssignmentDraftSummary } from "@/lib/admin/review-assignment";
import {
  type QuestionOrderMode,
  type TimingMode,
} from "@/lib/admin/assignment-settings";
import {
  currentTimeMilliseconds,
  koreanDateTimeLocalToIso,
} from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

type ErrorResponse = {
  error?: string;
};

export function ReviewAssignmentDialog({
  draft,
}: {
  draft: ReviewAssignmentDraftSummary;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [directionRatio, setDirectionRatio] = useState<0 | 50 | 100>(50);
  const [questionOrderMode, setQuestionOrderMode] =
    useState<QuestionOrderMode>("random");
  const [timingMode, setTimingMode] = useState<TimingMode>("total");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(5);
  const [questionTimeLimitSeconds, setQuestionTimeLimitSeconds] =
    useState(20);
  const [passingScore, setPassingScore] = useState(80);
  const [availableUntilLocal, setAvailableUntilLocal] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, []);

  const timeLimitSeconds =
    timingMode === "total" ? timeLimitMinutes * 60 : 10800;
  const cannotCreate =
    submitting ||
    (timingMode === "total" &&
      (timeLimitSeconds < 30 || timeLimitSeconds > 10800)) ||
    (timingMode === "per_question" &&
      (questionTimeLimitSeconds < 5 ||
        questionTimeLimitSeconds > 600)) ||
    Date.parse(draft.expiresAt) <= currentTimeMilliseconds();

  function leaveDraft() {
    if (submitting || cancelling) return;
    dialogRef.current?.close();
    router.replace("/admin/assignments");
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) leaveDraft();
  }

  async function cancelDraft() {
    if (submitting || cancelling) return;
    setCancelling(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/students/${draft.studentId}/review-assignment-drafts/${draft.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as ErrorResponse & {
        status?: string;
        queueDisposition?: string;
      };
      if (
        !response.ok ||
        payload.status !== "cancelled" ||
        payload.queueDisposition !== "pending"
      ) {
        throw new Error(
          payload.error ?? "재시험 준비를 취소하지 못했습니다.",
        );
      }
      router.replace("/admin/assignments");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "재시험 준비를 취소하지 못했습니다.",
      );
      setCancelling(false);
    }
  }

  async function submitReviewAssignment(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setError("");
    const availableUntil = availableUntilLocal
      ? koreanDateTimeLocalToIso(availableUntilLocal)
      : null;
    if (
      availableUntilLocal &&
      (!availableUntil ||
        Date.parse(availableUntil) <= currentTimeMilliseconds())
    ) {
      setError(adminLearningText.assignmentModal.deadline.invalid);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/review-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewDraftId: draft.id,
          title: customTitle,
          englishToKoreanRatio: directionRatio,
          timeLimitSeconds,
          timingMode,
          questionTimeLimitSeconds:
            timingMode === "per_question"
              ? questionTimeLimitSeconds
              : null,
          passingScore,
          questionOrderMode,
          availableUntil,
        }),
      });
      const payload = (await response.json()) as ErrorResponse;
      if (!response.ok) {
        throw new Error(
          payload.error ?? "오답 재시험을 배정하지 못했습니다.",
        );
      }
      router.replace("/admin/assignments");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "오답 재시험을 배정하지 못했습니다.",
      );
      setSubmitting(false);
    }
  }

  return (
    <dialog
      aria-labelledby="review-assignment-dialog-title"
      className="dialog dialog-extra-wide assignment-dialog"
      onCancel={(event) => {
        event.preventDefault();
        leaveDraft();
      }}
      onClick={closeOnBackdrop}
      ref={dialogRef}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">
            {adminLearningText.reviewAssignmentModal.eyebrow}
          </p>
          <h2 id="review-assignment-dialog-title">
            {draft.studentName}
          </h2>
          <p>
            {[draft.schoolName, draft.gradeLabel]
              .filter(Boolean)
              .join(" · ") || "학교·학년 미입력"}
          </p>
        </div>
        <button
          aria-label="닫기"
          className="button button-quiet button-small"
          disabled={submitting || cancelling}
          onClick={leaveDraft}
          type="button"
        >
          닫기
        </button>
      </div>

      <div className="assignment-dialog-context">
        <strong>{draft.datasetLabel}</strong>
        <span>선택한 오답 {draft.questionCount}개</span>
        <span>초안 만료 · {formatKoreanDateTime(draft.expiresAt)}</span>
      </div>

      <form
        aria-busy={submitting}
        className="assignment-modal-form"
        onSubmit={submitReviewAssignment}
      >
        <section className="assignment-step">
          <div className="assignment-step-heading">
            <span>1</span>
            <div>
              <h3>
                {adminLearningText.reviewAssignmentModal.fixedTargetTitle}
                <HelpTip label="재시험 대상 도움말">
                  {adminLearningText.reviewAssignmentModal.fixedTargetHelp}
                </HelpTip>
              </h3>
            </div>
          </div>
          <div className="assignment-review-summary">
            <dl>
              <div>
                <dt>학생</dt>
                <dd>{draft.studentName}</dd>
              </div>
              <div>
                <dt>단어장</dt>
                <dd>{draft.datasetLabel}</dd>
              </div>
              <div>
                <dt>문항 수</dt>
                <dd>{draft.questionCount}문항</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="assignment-step">
          <div className="assignment-step-heading">
            <span>2</span>
            <div>
              <h3>
                {adminLearningText.reviewAssignmentModal.conditionsTitle}
                <HelpTip label="문제 조건 도움말">
                  {adminLearningText.reviewAssignmentModal.conditionsHelp}
                </HelpTip>
              </h3>
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
              </select>
            </label>
            <label className="field">
              <span className="field-label">문제 순서</span>
              <select
                onChange={(event) =>
                  setQuestionOrderMode(
                    event.target.value as QuestionOrderMode,
                  )
                }
                value={questionOrderMode}
              >
                <option value="ascending">오름차순</option>
                <option value="descending">내림차순</option>
                <option value="random">무작위</option>
              </select>
            </label>
          </div>
          <div className="assignment-condition-grid">
            <fieldset className="field timing-mode-field">
              <legend className="field-label label-with-help">
                시간 제한 방식
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
                  전체 시험
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
                {timingMode === "total"
                  ? "전체 시험 시간(분)"
                  : "문제당 시간(초)"}
              </span>
              {timingMode === "total" ? (
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
              ) : (
                <input
                  max={600}
                  min={5}
                  onChange={(event) =>
                    setQuestionTimeLimitSeconds(
                      Number(event.target.value),
                    )
                  }
                  required
                  type="number"
                  value={questionTimeLimitSeconds}
                />
              )}
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
          <div className="field">
            <span className="field-label label-with-help">
              <label htmlFor="review-assignment-available-until">
                {adminLearningText.assignmentModal.deadline.label}
              </label>
              <HelpTip label="응시 마감 시간 설정 도움말">
                {adminLearningText.reviewAssignmentModal.deadlineHelp}
              </HelpTip>
            </span>
            <input
              id="review-assignment-available-until"
              onChange={(event) =>
                setAvailableUntilLocal(event.target.value)
              }
              step={60}
              type="datetime-local"
              value={availableUntilLocal}
            />
          </div>
        </section>

        <section className="assignment-submit-panel">
          <div className="field">
            <span className="field-label label-with-help">
              <label htmlFor="review-assignment-custom-title">
                {adminLearningText.assignmentModal.submit.optionalTitle}
              </label>
              <HelpTip label="시험 이름 도움말">
                {adminLearningText.reviewAssignmentModal.titleHelp}
              </HelpTip>
            </span>
            <input
              id="review-assignment-custom-title"
              maxLength={160}
              onChange={(event) => setCustomTitle(event.target.value)}
              placeholder={draft.generatedTitle}
              value={customTitle}
            />
          </div>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <button
              aria-busy={cancelling}
              className="button button-quiet"
              disabled={submitting || cancelling}
              onClick={() => void cancelDraft()}
              type="button"
            >
              {cancelling
                ? adminLearningText.reviewAssignmentModal.cancelingDraft
                : adminLearningText.reviewAssignmentModal.cancelDraft}
            </button>
            <button
              className="button button-primary button-large"
              disabled={cannotCreate || cancelling}
              type="submit"
            >
              {submitting
                ? adminLearningText.reviewAssignmentModal.assigning
                : adminLearningText.reviewAssignmentModal.assign}
            </button>
          </div>
        </section>
      </form>
    </dialog>
  );
}
