"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { HelpTip } from "@/components/help-tip";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
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
import { SelectField } from "@/components/ui-select";
import {
  ModalBody,
  ModalFooter,
  ModalFrame,
  ModalHeader,
} from "@/components/ui-modal";
import { Button } from "@/components/ui-button";

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
          payload.error ?? adminLearningText.reviewAssignmentModal.cancelError,
        );
      }
      toast.success(adminLearningText.reviewAssignmentModal.cancelSuccess);
      router.replace("/admin/assignments");
      router.refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminLearningText.reviewAssignmentModal.cancelError,
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
          payload.error ?? adminLearningText.reviewAssignmentModal.assignError,
        );
      }
      toast.success(adminLearningText.reviewAssignmentModal.assignSuccess);
      router.replace("/admin/assignments");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminLearningText.reviewAssignmentModal.assignError,
      );
      setSubmitting(false);
    }
  }

  return (
    <ModalFrame
      aria-labelledby="review-assignment-dialog-title"
      className="dialog-extra-wide assignment-dialog"
      onCancel={(event) => {
        event.preventDefault();
        leaveDraft();
      }}
      onClick={closeOnBackdrop}
      ref={dialogRef}
    >
      <ModalHeader
        disabled={submitting || cancelling}
        onClose={leaveDraft}
      >
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
              .join(" · ") ||
              adminLearningText.reviewAssignmentModal.missingSchoolGrade}
          </p>
        </div>
      </ModalHeader>

      <ModalBody>
      <div className="assignment-dialog-context">
        <strong>{draft.datasetLabel}</strong>
        <span>
          {formatContentText(
            adminLearningText.reviewAssignmentModal.selectedWrongCount,
            { count: draft.questionCount },
          )}
        </span>
        <span>
          {formatContentText(
            adminLearningText.reviewAssignmentModal.expiresAt,
            { datetime: formatKoreanDateTime(draft.expiresAt) },
          )}
        </span>
      </div>

      <form
        aria-busy={submitting}
        id="review-assignment-form"
        className="assignment-modal-form"
        onSubmit={submitReviewAssignment}
      >
        <section className="assignment-step">
          <div className="assignment-step-heading">
            <span>1</span>
            <div>
              <h3>
                {adminLearningText.reviewAssignmentModal.fixedTargetTitle}
                <HelpTip
                  label={adminLearningText.reviewAssignmentModal.targetHelpAria}
                >
                  {adminLearningText.reviewAssignmentModal.fixedTargetHelp}
                </HelpTip>
              </h3>
            </div>
          </div>
          <div className="assignment-review-summary">
            <dl>
              <div>
                <dt>{adminLearningText.reviewAssignmentModal.student}</dt>
                <dd>{draft.studentName}</dd>
              </div>
              <div>
                <dt>{adminLearningText.reviewAssignmentModal.dataset}</dt>
                <dd>{draft.datasetLabel}</dd>
              </div>
              <div>
                <dt>
                  {adminLearningText.reviewAssignmentModal.questionCountLabel}
                </dt>
                <dd>
                  {formatContentText(
                    adminLearningText.reviewAssignmentModal.questionCount,
                    { count: draft.questionCount },
                  )}
                </dd>
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
                <HelpTip
                  label={
                    adminLearningText.reviewAssignmentModal.conditionsHelpAria
                  }
                >
                  {adminLearningText.reviewAssignmentModal.conditionsHelp}
                </HelpTip>
              </h3>
            </div>
          </div>
          <div className="form-grid-2">
            <label className="field">
              <span className="field-label">
                {adminLearningText.controls.direction.label}
              </span>
              <SelectField
                onChange={(event) =>
                  setDirectionRatio(
                    Number(event.target.value) as 0 | 50 | 100,
                  )
                }
                value={directionRatio}
              >
                <option value={100}>
                  {adminLearningText.controls.direction.englishToMeaning}
                </option>
                <option value={0}>
                  {adminLearningText.controls.direction.meaningToEnglish}
                </option>
                <option value={50}>
                  {adminLearningText.controls.direction.mixed}
                </option>
              </SelectField>
            </label>
            <label className="field">
              <span className="field-label">
                {adminLearningText.controls.order.label}
              </span>
              <SelectField
                onChange={(event) =>
                  setQuestionOrderMode(
                    event.target.value as QuestionOrderMode,
                  )
                }
                value={questionOrderMode}
              >
                <option value="ascending">
                  {adminLearningText.controls.order.ascending}
                </option>
                <option value="descending">
                  {adminLearningText.controls.order.descending}
                </option>
                <option value="random">
                  {adminLearningText.controls.order.random}
                </option>
              </SelectField>
            </label>
          </div>
          <div className="assignment-condition-grid">
            <fieldset className="field timing-mode-field">
              <legend className="field-label label-with-help">
                {adminLearningText.controls.timing.label}
                <HelpTip label={adminLearningText.controls.timing.helpAria}>
                  {adminLearningText.assignmentModal.conditions.timingHelp}
                </HelpTip>
              </legend>
              <div className="segmented-control">
                <Button
                  aria-pressed={timingMode === "total"}
                  onClick={() => setTimingMode("total")}
                >
                  {adminLearningText.controls.timing.total}
                </Button>
                <Button
                  aria-pressed={timingMode === "per_question"}
                  onClick={() => setTimingMode("per_question")}
                >
                  {adminLearningText.controls.timing.perQuestion}
                </Button>
              </div>
            </fieldset>
            <label className="field">
              <span className="field-label">
                {timingMode === "total"
                  ? adminLearningText.controls.timing.totalExamMinutes
                  : adminLearningText.controls.timing.perQuestionSeconds}
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
              <span className="field-label">
                {adminLearningText.controls.passingScore}
              </span>
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
              <HelpTip label={adminLearningText.controls.deadlineHelpAria}>
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
              <HelpTip label={adminLearningText.controls.titleHelpAria}>
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
        </section>
      </form>
      </ModalBody>
      <ModalFooter>
        <Button
          aria-busy={cancelling}
          disabled={submitting || cancelling}
          onClick={() => void cancelDraft()}
          variant="quiet"
        >
          {cancelling
            ? adminLearningText.reviewAssignmentModal.cancelingDraft
            : adminLearningText.reviewAssignmentModal.cancelDraft}
        </Button>
        <Button
          disabled={cannotCreate || cancelling}
          form="review-assignment-form"
          size="large"
          type="submit"
          variant="primary"
        >
          {submitting
            ? adminLearningText.reviewAssignmentModal.assigning
            : adminLearningText.reviewAssignmentModal.assign}
        </Button>
      </ModalFooter>
    </ModalFrame>
  );
}
