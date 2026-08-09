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
import { toast } from "sonner";

import { MetaTag, MetaTagList } from "@/components/admin-meta-tags";
import { HelpTip } from "@/components/help-tip";
import { Button } from "@/components/ui-button";
import { SelectField } from "@/components/ui-select";
import {
  ModalBody,
  ModalFooter,
  ModalFrame,
  ModalHeader,
} from "@/components/ui-modal";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import type { ReviewLevel } from "@/lib/admin/assignment-submission";
import type { BulkAssignmentRangeMode } from "@/lib/admin/bulk-assignment-range";
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
  unitIds: string[];
  unitLabels: string[];
  rangeTruncated: boolean;
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
  const [rangeMode, setRangeMode] =
    useState<BulkAssignmentRangeMode>("previous_span");
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
        rangeMode,
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
              : adminLearningText.bulkAssignmentModal.previewError,
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
            : adminLearningText.bulkAssignmentModal.previewError,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [
    directionRatio,
    includePendingReview,
    rangeMode,
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
          rangeMode,
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
        throw new Error(
          payload.error ?? adminLearningText.bulkAssignmentModal.saveError,
        );
      }
      onSuccess();
      dialogRef.current?.close();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminLearningText.bulkAssignmentModal.saveError,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalFrame
      aria-labelledby="bulk-assignment-title"
      className="dialog-extra-wide bulk-assignment-dialog"
      onCancel={cancel}
      onClick={closeOnBackdrop}
      onClose={onClose}
      ref={dialogRef}
    >
      <ModalHeader
        closeLabel={adminLearningText.bulkAssignmentModal.close}
        disabled={submitting}
        onClose={close}
      >
        <div>
          <h2 className="label-with-help" id="bulk-assignment-title">
            {includePendingReview
              ? adminLearningText.bulkAssignmentModal.withWrongTitle
              : adminLearningText.bulkAssignmentModal.nextTitle}
            <HelpTip
              label={adminLearningText.bulkAssignmentModal.autoRangeHelpAria}
            >
              {adminLearningText.bulkAssignmentModal.autoRangeHelp}
            </HelpTip>
          </h2>
          <p>
            {formatContentText(
              adminLearningText.bulkAssignmentModal.studentCount,
              { count: students.length },
            )}
          </p>
        </div>
      </ModalHeader>

      <ModalBody>
      <form
        className="bulk-assignment-form"
        id="bulk-assignment-form"
        onSubmit={submit}
      >
          <section className="bulk-assignment-settings">
            <label className="field bulk-range-mode-field">
              <span className="field-label label-with-help">
                {adminLearningText.bulkAssignmentModal.rangeMode.label}
                <HelpTip
                  label={
                    adminLearningText.bulkAssignmentModal.rangeMode.helpAria
                  }
                >
                  {adminLearningText.bulkAssignmentModal.rangeMode.help}
                </HelpTip>
              </span>
              <SelectField
                onChange={(event) => {
                  setPreviewLoading(true);
                  setPreview(null);
                  setError("");
                  setRangeMode(
                    event.target.value as BulkAssignmentRangeMode,
                  );
                }}
                value={rangeMode}
              >
                <option value="single">
                  {adminLearningText.bulkAssignmentModal.rangeMode.single}
                </option>
                <option value="previous_span">
                  {
                    adminLearningText.bulkAssignmentModal.rangeMode
                      .previousSpan
                  }
                </option>
                <option value="week_span">
                  {adminLearningText.bulkAssignmentModal.rangeMode.weekSpan}
                </option>
              </SelectField>
            </label>
            <label className="field">
              <span className="field-label">
                {adminLearningText.controls.direction.label}
              </span>
              <SelectField
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
                  setQuestionOrderMode(event.target.value as QuestionOrderMode)
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
            <label className="field">
              <span className="field-label">
                {adminLearningText.controls.passingScore}
              </span>
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
                <HelpTip label={adminLearningText.controls.timing.helpAria}>
                  {adminLearningText.assignmentModal.conditions.timingHelp}
                </HelpTip>
              </legend>
              <div className="segmented-control">
                <Button
                  aria-pressed={timingMode === "total"}
                  onClick={() => setTimingMode("total")}
                >
                  {adminLearningText.controls.timing.totalShort}
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
                  ? adminLearningText.controls.timing.totalMinutes
                  : adminLearningText.controls.timing.perQuestionSeconds}
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
                <HelpTip label={adminLearningText.controls.deadlineHelpAria}>
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
              <legend>
                {adminLearningText.bulkAssignmentModal.wrongWordsLegend}
              </legend>
              <div className="filter-chip-row">
                <Button
                  aria-pressed={reviewLevels.includes(1)}
                  className="filter-chip"
                  onClick={() => toggleReviewLevel(1)}
                  size="small"
                  variant="quiet"
                >
                  {adminLearningText.bulkAssignmentModal.wrongOnce}
                </Button>
                <Button
                  aria-pressed={reviewLevels.includes(2)}
                  className="filter-chip"
                  onClick={() => toggleReviewLevel(2)}
                  size="small"
                  variant="quiet"
                >
                  {adminLearningText.bulkAssignmentModal.wrongRepeated}
                </Button>
              </div>
            </fieldset>
          ) : null}

          <section className="bulk-preview-section" aria-busy={previewLoading}>
            <div className="learning-section-heading">
              <h3 className="label-with-help">
                {adminLearningText.bulkAssignmentModal.previewTitle}
                <HelpTip
                  label={adminLearningText.bulkAssignmentModal.atomicHelpAria}
                >
                  {adminLearningText.bulkAssignmentModal.atomicHelp}
                </HelpTip>
              </h3>
              <span>
                {previewLoading
                  ? adminLearningText.bulkAssignmentModal.calculating
                  : formatContentText(
                      adminLearningText.bulkAssignmentModal.previewSummary,
                      {
                        assignable: preview?.assignableCount ?? 0,
                        blocked: preview?.blockedCount ?? 0,
                      },
                    )}
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
                unitIds: [],
                unitLabels: [],
                rangeTruncated: false,
                questionCount: 0,
                wrongCount: 0,
                error: null,
              }))).map((item) => (
                <article className="bulk-preview-row" key={item.studentId}>
                  <strong>{item.studentName}</strong>
                  <MetaTagList>
                    <MetaTag>
                      {item.datasetLabel ??
                        adminLearningText.bulkAssignmentModal.datasetPending}
                    </MetaTag>
                    <MetaTag>
                      {item.unitLabel ??
                        adminLearningText.bulkAssignmentModal.rangePending}
                    </MetaTag>
                    {item.rangeTruncated ? (
                      <MetaTag tone="warning">
                        {
                          adminLearningText.bulkAssignmentModal.rangeMode
                            .remainingOnly
                        }
                      </MetaTag>
                    ) : null}
                    {item.available ? (
                      <MetaTag tone="positive">
                        {formatContentText(
                          adminLearningText.bulkAssignmentModal.questionCount,
                          { count: item.questionCount },
                        )}
                      </MetaTag>
                    ) : (
                      <MetaTag tone="danger">
                        {adminLearningText.bulkAssignmentModal.needsReview}
                      </MetaTag>
                    )}
                    {includePendingReview && item.wrongCount > 0 ? (
                      <MetaTag tone="warning">
                        {formatContentText(
                          adminLearningText.bulkAssignmentModal.wrongCount,
                          { count: item.wrongCount },
                        )}
                      </MetaTag>
                    ) : null}
                  </MetaTagList>
                  {item.error ? <small>{item.error}</small> : null}
                </article>
              ))}
            </div>
          </section>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
      </form>
      </ModalBody>
      <ModalFooter>
        <Button
          disabled={
            submitting ||
            previewLoading ||
            !preview ||
            preview.blockedCount > 0 ||
            preview.assignableCount !== students.length
          }
          form="bulk-assignment-form"
          type="submit"
          variant="primary"
        >
          {submitting
            ? adminLearningText.bulkAssignmentModal.submitting
            : formatContentText(
                adminLearningText.bulkAssignmentModal.submit,
                { count: students.length },
              )}
        </Button>
      </ModalFooter>
    </ModalFrame>
  );
}
