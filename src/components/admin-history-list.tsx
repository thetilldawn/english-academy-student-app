"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import {
  assignmentDisplayTitle,
  assignmentOrderLabel,
  assignmentScopeLabel,
} from "@/lib/admin/history";
import {
  compareLearningActivities,
  learningActivitySection,
} from "@/lib/admin/learning-activity";
import { DeadlineCountdown } from "@/components/deadline-countdown";
import { AdminHistoryActions } from "@/components/admin-history-actions";
import {
  AttemptScoreSummary,
  AttemptStatusLabel,
} from "@/components/attempt-score-summary";
import { AssignmentMetaTags } from "@/components/admin-meta-tags";
import { adminHistoryText } from "@/content/ko/admin-history";
import { formatContentText } from "@/content/format";
import { buildAttemptStatusPresentation } from "@/lib/ui/attempt-score-presentation";
import {
  currentTimeMilliseconds,
  secondsUntil,
} from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";
import { SelectField } from "@/components/ui-select";
import { ModalBody, ModalFrame, ModalHeader } from "@/components/ui-modal";
import { ButtonLink } from "@/components/ui-button";

type AttemptQuestion = {
  id: string;
  orderIndex: number;
  headword: string;
  prompt: string;
  correctAnswer: string;
  initialChoice: string | null;
  initialIsCorrect: boolean | null;
  retryChoice: string | null;
  retryIsCorrect: boolean | null;
};

type AttemptDetail = {
  id: string;
  elapsedSeconds: number | null;
  questions: AttemptQuestion[];
};

type DetailResponse = {
  result?: AttemptDetail;
  error?: string;
};

type HistoryStatusFilter =
  | "all"
  | "open"
  | "needs_attention"
  | "completed"
  | "retried"
  | "archived";

function statusPresentation(item: AssignmentHistorySummary) {
  return buildAttemptStatusPresentation({
    status: item.status,
    phase: item.phase,
    initialScore: item.initialScore,
    finalScore: item.finalScore,
    passingScore: item.passingScore,
    retryStartedAt: item.retryStartedAt,
  });
}

function directionLabel(ratio: number) {
  if (ratio === 100) return adminHistoryText.list.direction.englishToMeaning;
  if (ratio === 0) return adminHistoryText.list.direction.meaningToEnglish;
  return adminHistoryText.list.direction.mixed;
}

function elapsedText(seconds: number | null) {
  if (seconds === null) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return formatContentText(adminHistoryText.list.elapsed, {
    minutes,
    seconds: remainder,
  });
}

function activityTimeText(
  item: AssignmentHistorySummary,
  compact: boolean,
) {
  if (item.status === "missed") {
    return formatContentText(adminHistoryText.list.deadline, {
      datetime: formatKoreanDateTime(item.missedAt ?? item.availableUntil),
    });
  }
  if (item.status === "cancelled") {
    return formatContentText(adminHistoryText.list.cancelled, {
      datetime: formatKoreanDateTime(item.cancelledAt),
    });
  }
  if (item.status === "not_started") {
    return item.availableUntil
      ? formatContentText(adminHistoryText.list.deadline, {
          datetime: formatKoreanDateTime(item.availableUntil),
        })
      : formatContentText(adminHistoryText.list.assigned, {
          datetime: formatKoreanDateTime(item.assignedAt),
        });
  }
  if (item.status === "in_progress") {
    if (item.phase === "review") {
      return formatContentText(adminHistoryText.list.failed, {
        datetime: formatKoreanDateTime(
          item.initialCompletedAt ?? item.startedAt,
        ),
      });
    }
    return formatContentText(adminHistoryText.list.started, {
      datetime: formatKoreanDateTime(item.startedAt),
    });
  }

  const finishedAt =
    item.status === "expired"
      ? item.deadlineAt ?? item.activityAt
      : item.completedAt ?? item.activityAt;
  const wrongSummary =
    compact &&
    (item.status === "expired" ||
      (item.status === "completed" &&
        statusPresentation(item).outcome === "failed")) &&
    item.unresolvedWrongCount !== null
      ? formatContentText(adminHistoryText.list.remainingWrong, {
          count: item.unresolvedWrongCount,
        })
      : "";
  return formatContentText(adminHistoryText.list.finished, {
    datetime: formatKoreanDateTime(finishedAt),
    wrong: wrongSummary,
  });
}

export function AdminHistoryList({
  items,
  compact = false,
  initialItemId = "",
  launcherOnly = false,
  onLauncherClose,
  onSelectStudent,
  showFilters = false,
}: {
  items: AssignmentHistorySummary[];
  compact?: boolean;
  initialItemId?: string;
  launcherOnly?: boolean;
  onLauncherClose?: () => void;
  onSelectStudent?: (studentId: string) => void;
  showFilters?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailRequestRef = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItemId || null,
  );
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDeadlineRemaining, setSelectedDeadlineRemaining] =
    useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<HistoryStatusFilter>("all");
  const selected = useMemo(
    () =>
      items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return items.filter((item) => {
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "retried"
          ? statusPresentation(item).outcome === "retried"
          : learningActivitySection(item) === statusFilter);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          item.studentName,
          item.schoolName,
          item.gradeLabel,
          item.assignmentTitle,
          item.datasetTitle,
          ...item.unitLabels,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      return matchesStatus && matchesQuery;
    }).toSorted(compareLearningActivities);
  }, [items, query, statusFilter]);

  useEffect(() => {
    if (!selected) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [selected]);

  useEffect(
    () => () => detailRequestRef.current?.abort(),
    [],
  );

  function openHistory(item: AssignmentHistorySummary) {
    detailRequestRef.current?.abort();
    setSelectedId(item.id);
    setDetail(null);
    setDetailError("");
    setSelectedDeadlineRemaining(
      secondsUntil(item.availableUntil, currentTimeMilliseconds()),
    );

    if (!item.attemptId) {
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    detailRequestRef.current = controller;
    setDetailLoading(true);
    void fetch(`/api/admin/attempts/${item.attemptId}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as DetailResponse;
        if (!response.ok || !payload.result) {
          throw new Error(
            payload.error ?? adminHistoryText.list.detailLoadError,
          );
        }
        setDetail(payload.result);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setDetailError(
          error instanceof Error
            ? error.message
            : adminHistoryText.list.detailLoadError,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeDialog();
  }

  const wrongQuestions =
    detail?.questions.filter(
      (question) => question.initialIsCorrect === false,
    ) ?? [];
  const unansweredQuestions =
    detail?.questions.filter(
      (question) => question.initialIsCorrect === null,
    ) ?? [];

  return (
    <>
      {!launcherOnly ? (
        <>
          {showFilters && (
            <div className="history-filters">
          <label className="field">
            <span className="field-label">
              {adminHistoryText.filters.searchLabel}
            </span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={adminHistoryText.filters.searchPlaceholder}
              type="search"
              value={query}
            />
          </label>
          <label className="field">
            <span className="field-label">
              {adminHistoryText.filters.statusLabel}
            </span>
            <SelectField
              onChange={(event) =>
                  setStatusFilter(event.target.value as HistoryStatusFilter)
              }
              value={statusFilter}
            >
              <option value="all">
                {adminHistoryText.filters.statusOptions.all}
              </option>
              <option value="open">
                {adminHistoryText.filters.statusOptions.open}
              </option>
              <option value="needs_attention">
                {adminHistoryText.filters.statusOptions.needsAttention}
              </option>
              <option value="completed">
                {adminHistoryText.filters.statusOptions.completed}
              </option>
              <option value="retried">
                {adminHistoryText.filters.statusOptions.retried}
              </option>
              <option value="archived">
                {adminHistoryText.filters.statusOptions.archived}
              </option>
            </SelectField>
          </label>
            </div>
          )}

          {filteredItems.length === 0 ? (
            <div className="empty-state">
              {items.length === 0
                ? adminHistoryText.emptyState.noAssignments
                : adminHistoryText.emptyState.noMatches}
            </div>
          ) : (
            <ol className="admin-history-list">
              {filteredItems.map((item) => (
                <li key={item.id}>
                  <button
                    className="admin-history-row"
                    data-outcome={statusPresentation(item).outcome}
                    data-compact={compact}
                    onClick={() => {
                      if (onSelectStudent && !item.studentDeleted) {
                        onSelectStudent(item.studentId);
                        return;
                      }
                      openHistory(item);
                    }}
                    type="button"
                  >
                    <span className="history-row-main">
                      <strong>{item.studentName}</strong>
                      <span>{assignmentDisplayTitle(item)}</span>
                      <AssignmentMetaTags {...item} compact={compact} />
                      <small className="card-time-meta">
                        {activityTimeText(item, compact)}
                      </small>
                    </span>
                    {!compact ||
                    item.initialScore !== null ||
                    item.status === "missed" ||
                    item.status === "expired" ? (
                      <AttemptScoreSummary
                        className="history-score-pair"
                        finalScore={item.finalScore}
                        initialScore={item.initialScore}
                        passingScore={item.passingScore}
                        phase={item.phase}
                        retryStartedAt={item.retryStartedAt}
                        status={item.status}
                      />
                    ) : null}
                    <AttemptStatusLabel
                      finalScore={item.finalScore}
                      initialScore={item.initialScore}
                      passingScore={item.passingScore}
                      phase={item.phase}
                      retryStartedAt={item.retryStartedAt}
                      status={item.status}
                    />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}

      {selected && (
        <ModalFrame
          aria-labelledby="history-dialog-title"
          className="dialog-wide history-dialog"
          onClick={closeOnBackdrop}
          onClose={() => {
            detailRequestRef.current?.abort();
            setSelectedId(null);
            setDetail(null);
            setDetailError("");
            setSelectedDeadlineRemaining(null);
            onLauncherClose?.();
          }}
          ref={dialogRef}
        >
          <ModalHeader
            closeLabel={adminHistoryText.detailModal.close}
            onClose={closeDialog}
          >
            <div>
              <p className="eyebrow">
                {adminHistoryText.detailModal.eyebrow}
              </p>
              <h2 id="history-dialog-title">{selected.studentName}</h2>
              <p>{selected.assignmentTitle}</p>
            </div>
          </ModalHeader>

          <ModalBody>

          <div className="history-dialog-scores">
            <div>
              <span>{adminHistoryText.detailModal.status}</span>
              <strong>{statusPresentation(selected).label}</strong>
            </div>
            <div className="history-dialog-score-card">
              <span>{adminHistoryText.detailModal.score}</span>
              <AttemptScoreSummary
                finalScore={selected.finalScore}
                initialScore={selected.initialScore}
                passingScore={selected.passingScore}
                phase={selected.phase}
                retryStartedAt={selected.retryStartedAt}
                status={selected.status}
              />
            </div>
            {!(["not_started", "missed", "cancelled"] as const).includes(
              selected.status as "not_started" | "missed" | "cancelled",
            ) ? (
              <div>
                <span>{adminHistoryText.detailModal.unresolvedWords}</span>
                <strong>
                  {selected.unresolvedWrongCount === null
                    ? "-"
                    : formatContentText(adminHistoryText.list.count, {
                        count: selected.unresolvedWrongCount,
                      })}
                </strong>
              </div>
            ) : null}
          </div>

          <dl className="history-dialog-details">
            <div>
              <dt>{adminHistoryText.detailModal.dataset}</dt>
              <dd>{selected.datasetTitle}</dd>
            </div>
            <div>
              <dt>{adminHistoryText.detailModal.range}</dt>
              <dd>{assignmentScopeLabel(selected)}</dd>
            </div>
            <div>
              <dt>{adminHistoryText.detailModal.conditions}</dt>
              <dd>
                {formatContentText(adminHistoryText.list.conditions, {
                  questions: selected.questionCount,
                  minutes: Math.ceil(selected.timeLimitSeconds / 60),
                  score: selected.passingScore,
                })}
              </dd>
            </div>
            <div>
              <dt>{adminHistoryText.detailModal.directionAndOrder}</dt>
              <dd>
                {directionLabel(selected.englishToKoreanRatio)} ·{" "}
                {assignmentOrderLabel(
                  selected.assignmentPurpose,
                  selected.questionOrderMode,
                )}
              </dd>
            </div>
            <div>
              <dt>{adminHistoryText.detailModal.assignedAt}</dt>
              <dd>{formatKoreanDateTime(selected.assignedAt)}</dd>
            </div>
            <div>
              <dt>{adminHistoryText.detailModal.startDeadline}</dt>
              <dd>
                {formatKoreanDateTime(selected.availableUntil)}
                {selected.status === "not_started" &&
                  selected.availableUntil &&
                  selectedDeadlineRemaining !== null && (
                    <>
                      {" · "}
                      <DeadlineCountdown
                        deadlineAt={selected.availableUntil}
                        initialRemainingSeconds={
                          selectedDeadlineRemaining
                        }
                        refreshOnExpire
                      />
                    </>
                  )}
              </dd>
            </div>
            <div>
              <dt>{adminHistoryText.detailModal.finishedAt}</dt>
              <dd>
                {selected.completedAt
                  ? formatKoreanDateTime(selected.completedAt)
                  : "-"}
              </dd>
            </div>
          </dl>

          {detailLoading && (
            <div className="dialog-loading" role="status">
              {adminHistoryText.detailModal.loadingQuestions}
            </div>
          )}
          {detailError && (
            <div className="notice notice-error" role="alert">
              {detailError}
            </div>
          )}
          {detail && (
            <section className="history-wrong-summary">
              <div className="section-heading">
                <h3>{adminHistoryText.detailModal.questionSummary}</h3>
                <span className="detail-chip">
                  {formatContentText(adminHistoryText.list.questionSummary, {
                    wrong: wrongQuestions.length,
                    unanswered: unansweredQuestions.length,
                    elapsed: elapsedText(detail.elapsedSeconds),
                  })}
                </span>
              </div>
              {wrongQuestions.length === 0 ? (
                <p className="list-meta">
                  {unansweredQuestions.length > 0
                    ? formatContentText(
                        adminHistoryText.list.unansweredNotice,
                        { count: unansweredQuestions.length },
                      )
                    : adminHistoryText.detailModal.allCorrect}
                </p>
              ) : (
                <ul>
                  {wrongQuestions.slice(0, 8).map((question) => (
                    <li key={question.id}>
                      <strong>{question.prompt}</strong>
                      <span>
                        {question.initialChoice ??
                          adminHistoryText.detailModal.unansweredChoice} →{" "}
                        {question.correctAnswer}
                        {" · "}
                        {question.retryIsCorrect === true
                          ? adminHistoryText.detailModal.retryCorrect
                          : question.retryIsCorrect === false
                            ? adminHistoryText.detailModal.retryWrong
                            : adminHistoryText.detailModal.noRetry}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {wrongQuestions.length > 8 && (
                <p className="list-meta">
                  {adminHistoryText.detailModal.truncatedHelp}
                </p>
              )}
            </section>
          )}

          <div className="dialog-actions">
            <AdminHistoryActions
              item={selected}
              onMutated={closeDialog}
              showDetailLink={false}
            />
            {selected.attemptId && (
              <ButtonLink
                href={`/admin/results/${selected.attemptId}`}
                variant="primary"
              >
                {adminHistoryText.detailModal.openDetail}
              </ButtonLink>
            )}
            {!selected.studentDeleted && (
              <ButtonLink
                href={`/admin/students?student=${selected.studentId}`}
              >
                {adminHistoryText.detailModal.openStudent}
              </ButtonLink>
            )}
          </div>
          </ModalBody>
        </ModalFrame>
      )}
    </>
  );
}
