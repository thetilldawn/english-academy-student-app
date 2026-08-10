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
  isoToKoreanDateTimeLocal,
  koreanDateTimeLocalToIso,
} from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

type BulkPreviewSession = {
  sessionNumber: number;
  available: boolean;
  unitId: string | null;
  unitLabel: string | null;
  unitIds: string[];
  unitLabels: string[];
  rangeTruncated: boolean;
  questionCount: number;
  wrongCount: number;
  availableFrom: string;
  availableUntil: string | null;
  error: string | null;
};

type BulkPreviewItem = {
  studentId: string;
  studentName: string;
  available: boolean;
  datasetId: string | null;
  datasetLabel: string | null;
  sessions: BulkPreviewSession[];
  error: string | null;
};

type BulkPreview = {
  items: BulkPreviewItem[];
  assignableCount: number;
  blockedCount: number;
  assignmentCount: number;
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
  onSuccess: (assignmentCount: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rangeMode, setRangeMode] =
    useState<BulkAssignmentRangeMode>("previous_span");
  const [unitsPerSession, setUnitsPerSession] = useState(1);
  const [sessionCount, setSessionCount] = useState(1);
  const [firstAvailableDate, setFirstAvailableDate] = useState(() =>
    isoToKoreanDateTimeLocal(new Date().toISOString()).slice(0, 10),
  );
  const [dayInterval, setDayInterval] = useState(1);
  const [directionRatio, setDirectionRatio] = useState<0 | 50 | 100>(50);
  const [reviewLevels, setReviewLevels] = useState<ReviewLevel[]>([1, 2]);
  const [questionOrderMode, setQuestionOrderMode] =
    useState<QuestionOrderMode>("random");
  const [timingMode, setTimingMode] = useState<TimingMode>("total");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(5);
  const [questionTimeLimitSeconds, setQuestionTimeLimitSeconds] =
    useState(20);
  const [passingScore, setPassingScore] = useState(80);
  const [firstAvailableUntilLocal, setFirstAvailableUntilLocal] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);
  const studentIdsKey = useMemo(
    () => students.map((student) => student.id).join(","),
    [students],
  );

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const firstAvailableFrom = firstAvailableDate
    ? koreanDateTimeLocalToIso(`${firstAvailableDate}T00:00`)
    : null;
  const firstAvailableUntil = firstAvailableUntilLocal
    ? koreanDateTimeLocalToIso(firstAvailableUntilLocal)
    : null;

  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [
    dayInterval,
    directionRatio,
    firstAvailableDate,
    firstAvailableUntilLocal,
    includePendingReview,
    passingScore,
    questionOrderMode,
    questionTimeLimitSeconds,
    rangeMode,
    reviewLevels,
    sessionCount,
    studentIdsKey,
    timeLimitMinutes,
    timingMode,
    unitsPerSession,
  ]);

  useEffect(() => {
    if (
      !firstAvailableFrom ||
      (firstAvailableUntilLocal &&
        (!firstAvailableUntil ||
          Date.parse(firstAvailableUntil) <= Date.parse(firstAvailableFrom)))
    ) {
      return;
    }
    const controller = new AbortController();
    void fetch("/api/admin/bulk-assignments/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        studentIds: studentIdsKey.split(",").filter(Boolean),
        rangeMode,
        unitsPerSession,
        sessionCount,
        firstAvailableFrom,
        dayInterval,
        firstAvailableUntil,
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
        setError("");
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
    dayInterval,
    firstAvailableFrom,
    firstAvailableUntil,
    firstAvailableUntilLocal,
    includePendingReview,
    rangeMode,
    reviewLevels,
    sessionCount,
    studentIdsKey,
    unitsPerSession,
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
    if (
      !firstAvailableFrom ||
      (firstAvailableUntilLocal &&
        (!firstAvailableUntil ||
          Date.parse(firstAvailableUntil) <= currentTimeMilliseconds() ||
          Date.parse(firstAvailableUntil) <= Date.parse(firstAvailableFrom)))
    ) {
      setError(
        firstAvailableDate
          ? adminLearningText.bulkAssignmentModal.firstDeadlineInvalid
          : adminLearningText.bulkAssignmentModal.firstDateRequired,
      );
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
          unitsPerSession,
          sessionCount,
          firstAvailableFrom,
          dayInterval,
          firstAvailableUntil,
          idempotencyKey:
            idempotencyKeyRef.current ?? crypto.randomUUID(),
          includePendingReview,
          reviewLevels,
          englishToKoreanRatio: directionRatio,
          timeLimitSeconds:
            timingMode === "total" ? timeLimitMinutes * 60 : 10800,
          passingScore,
          questionOrderMode,
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
      onSuccess(payload.assignments?.length ?? students.length * sessionCount);
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
                <option value="previous_span">
                  {
                    adminLearningText.bulkAssignmentModal.rangeMode
                      .previousSpan
                  }
                </option>
                <option value="fixed_span">
                  {adminLearningText.bulkAssignmentModal.rangeMode.fixedSpan}
                </option>
              </SelectField>
            </label>
            {rangeMode === "fixed_span" ? (
              <label className="field">
                <span className="field-label">
                  {adminLearningText.bulkAssignmentModal.unitsPerSession}
                </span>
                <input
                  max={30}
                  min={1}
                  onChange={(event) => {
                    setPreviewLoading(true);
                    setPreview(null);
                    setError("");
                    setUnitsPerSession(Number(event.target.value));
                  }}
                  type="number"
                  value={unitsPerSession}
                />
              </label>
            ) : null}
            <label className="field">
              <span className="field-label">
                {adminLearningText.bulkAssignmentModal.sessionCount}
              </span>
              <input
                max={7}
                min={1}
                onChange={(event) => {
                  setPreviewLoading(true);
                  setPreview(null);
                  setError("");
                  setSessionCount(Number(event.target.value));
                }}
                type="number"
                value={sessionCount}
              />
            </label>
            <label className="field">
              <span className="field-label">
                {adminLearningText.bulkAssignmentModal.firstAvailableDate}
              </span>
              <input
                onChange={(event) => {
                  const nextDate = event.target.value;
                  const nextFrom = nextDate
                    ? koreanDateTimeLocalToIso(`${nextDate}T00:00`)
                    : null;
                  setPreview(null);
                  setFirstAvailableDate(nextDate);
                  if (
                    !nextFrom ||
                    (firstAvailableUntil &&
                      Date.parse(firstAvailableUntil) <= Date.parse(nextFrom))
                  ) {
                    setPreviewLoading(false);
                    setError(
                      nextDate
                        ? adminLearningText.bulkAssignmentModal
                            .firstDeadlineInvalid
                        : adminLearningText.bulkAssignmentModal
                            .firstDateRequired,
                    );
                  } else {
                    setPreviewLoading(true);
                    setError("");
                  }
                }}
                required
                type="date"
                value={firstAvailableDate}
              />
            </label>
            <label className="field">
              <span className="field-label">
                {adminLearningText.bulkAssignmentModal.dayInterval}
              </span>
              <input
                max={30}
                min={1}
                onChange={(event) => {
                  setPreviewLoading(true);
                  setPreview(null);
                  setError("");
                  setDayInterval(Number(event.target.value));
                }}
                type="number"
                value={dayInterval}
              />
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
                <label htmlFor="bulk-assignment-first-available-until">
                  {adminLearningText.bulkAssignmentModal.firstDeadline}
                </label>
                <HelpTip label={adminLearningText.controls.deadlineHelpAria}>
                  {adminLearningText.bulkAssignmentModal.deadlineHelp}
                </HelpTip>
              </span>
              <input
                id="bulk-assignment-first-available-until"
                onChange={(event) => {
                    const nextValue = event.target.value;
                    const nextIso = nextValue
                      ? koreanDateTimeLocalToIso(nextValue)
                      : null;
                    setPreview(null);
                    setFirstAvailableUntilLocal(nextValue);
                    if (
                      nextValue &&
                      (!nextIso ||
                        !firstAvailableFrom ||
                        Date.parse(nextIso) <= Date.parse(firstAvailableFrom))
                    ) {
                      setPreviewLoading(false);
                      setError(
                        adminLearningText.bulkAssignmentModal
                          .firstDeadlineInvalid,
                      );
                    } else {
                      setPreviewLoading(true);
                      setError("");
                    }
                  }}
                type="datetime-local"
                value={firstAvailableUntilLocal}
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
              <span className="learning-section-summary">
                {previewLoading
                  ? adminLearningText.bulkAssignmentModal.calculating
                  : formatContentText(
                      adminLearningText.bulkAssignmentModal.previewSummary,
                      {
                        assignable: preview?.assignableCount ?? 0,
                        sessions: sessionCount,
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
                sessions: [],
                error: null,
              }))).map((item) => (
                <article className="bulk-preview-row" key={item.studentId}>
                  <div className="bulk-preview-student-heading">
                    <strong>{item.studentName}</strong>
                    <MetaTag>
                      {item.datasetLabel ??
                        adminLearningText.bulkAssignmentModal.datasetPending}
                    </MetaTag>
                  </div>
                  <div className="bulk-preview-session-list">
                    {item.sessions.length > 0 ? item.sessions.map((session) => (
                      <div
                        className="bulk-preview-session"
                        key={`${item.studentId}-${session.sessionNumber}`}
                      >
                        <strong>
                          {formatContentText(
                            adminLearningText.bulkAssignmentModal.sessionLabel,
                            { count: session.sessionNumber },
                          )}
                        </strong>
                        <MetaTagList>
                          <MetaTag>
                            {session.unitLabel ??
                              adminLearningText.bulkAssignmentModal.rangePending}
                          </MetaTag>
                          <MetaTag>
                            {formatContentText(
                              adminLearningText.bulkAssignmentModal
                                .assignmentDateTag,
                              {
                                datetime: formatKoreanDateTime(
                                  session.availableFrom,
                                ),
                              },
                            )}
                          </MetaTag>
                          {session.availableUntil ? (
                            <MetaTag>
                              {formatContentText(
                                adminLearningText.bulkAssignmentModal.deadlineTag,
                                {
                                  datetime: formatKoreanDateTime(
                                    session.availableUntil,
                                  ),
                                },
                              )}
                            </MetaTag>
                          ) : null}
                          {session.rangeTruncated ? (
                            <MetaTag tone="warning">
                              {
                                adminLearningText.bulkAssignmentModal.rangeMode
                                  .remainingOnly
                              }
                            </MetaTag>
                          ) : null}
                          {session.available ? (
                            <MetaTag tone="positive">
                              {formatContentText(
                                adminLearningText.bulkAssignmentModal.questionCount,
                                { count: session.questionCount },
                              )}
                            </MetaTag>
                          ) : (
                            <MetaTag tone="danger">
                              {adminLearningText.bulkAssignmentModal.needsReview}
                            </MetaTag>
                          )}
                          {includePendingReview && session.wrongCount > 0 ? (
                            <MetaTag tone="warning">
                              {formatContentText(
                                adminLearningText.bulkAssignmentModal.wrongCount,
                                { count: session.wrongCount },
                              )}
                            </MetaTag>
                          ) : null}
                        </MetaTagList>
                        {session.error ? <small>{session.error}</small> : null}
                      </div>
                    )) : (
                      <span>
                        {adminLearningText.bulkAssignmentModal.rangePending}
                      </span>
                    )}
                  </div>
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
                {
                  studentCount: students.length,
                  assignmentCount:
                    preview?.assignmentCount ?? students.length * sessionCount,
                },
              )}
        </Button>
      </ModalFooter>
    </ModalFrame>
  );
}
