"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type WrongWordAggregate,
  type StudentWrongWordHistory,
  type WrongWordOutcome,
} from "@/lib/admin/wrong-word-history";
import { formatKoreanDateTime } from "@/lib/format";
import { HelpTip } from "@/components/help-tip";
import { adminStudentsText } from "@/content/ko/admin-students";
import { formatContentText } from "@/content/format";
import { SelectField } from "@/components/ui-select";
import { Button } from "@/components/ui-button";
import {
  readingCurriculumStageLabel,
  readingCurriculumStages,
  type ReadingCurriculumStage,
} from "@/lib/admin/reading-curriculum";

type LevelFilter = "all" | "once" | "repeated";
type SelectionPurpose = "next_exam" | "worksheet";
const WRONG_HISTORY_CACHE_TTL_MS = 30_000;

function outcomeLabel(outcome: WrongWordOutcome) {
  const copy = adminStudentsText.learning.wrongWordsPanel;
  if (outcome === "recovered_on_retry") return copy.retryRecovered;
  if (outcome === "wrong_again") return copy.retryWrong;
  return copy.retryUnanswered;
}

function matchesQuery(
  query: string,
  values: Array<string | null | undefined>,
) {
  const keyword = query.trim().toLocaleLowerCase("ko-KR");
  if (!keyword) return true;
  return values
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(keyword);
}

function selectionTarget(
  word: WrongWordAggregate,
  datasetId: string,
) {
  const candidates = datasetId
    ? word.occurrences.filter(
        (candidate) => candidate.datasetId === datasetId,
      )
    : word.occurrences;
  const occurrence =
    candidates.find(
      (candidate) =>
        candidate.resolution === "unresolved" &&
        candidate.scheduling === "assigned",
    ) ??
    candidates.find(
      (candidate) =>
        candidate.resolution === "unresolved" &&
        candidate.scheduling === "queued",
    ) ??
    candidates.find(
      (candidate) =>
        candidate.resolution === "unresolved" &&
        candidate.scheduling === "available",
    ) ??
    candidates.find(
      (candidate) => candidate.resolution === "unresolved",
    ) ??
    candidates.find(
      (candidate) =>
        candidate.datasetId === word.latestDatasetId &&
        candidate.vocabEntryId === word.latestVocabEntryId,
    );
  const selectedOccurrence = occurrence ?? word.occurrences[0];
  if (!selectedOccurrence) return null;
  return {
    datasetId: selectedOccurrence.datasetId,
    questionId: selectedOccurrence.latestQuestionId,
    resolution: selectedOccurrence.resolution,
    scheduling: selectedOccurrence.scheduling,
    activeAssignment: selectedOccurrence.activeAssignment,
  };
}

function worksheetSelectionTarget(
  word: WrongWordAggregate,
  datasetId: string,
) {
  const candidates = datasetId
    ? word.occurrences.filter(
        (candidate) => candidate.datasetId === datasetId,
      )
    : word.occurrences;
  const occurrence = candidates.find(
    (candidate) => candidate.resolution === "unresolved",
  );
  if (!occurrence) return null;
  return {
    questionId: occurrence.latestQuestionId,
    resolution: occurrence.resolution,
  };
}

export function StudentWrongWordPanel({
  active,
  cachedAt,
  cachedHistory,
  initialDatasetId = "",
  initialCurriculumStage = "undecided",
  initialReadingContextSyncStatus = "not_synced",
  onDataUpdated,
  onLoaded,
  studentId,
}: {
  active: boolean;
  cachedAt: number | null;
  cachedHistory: StudentWrongWordHistory | null;
  initialDatasetId?: string;
  initialCurriculumStage?: ReadingCurriculumStage;
  initialReadingContextSyncStatus?:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  onDataUpdated?: () => void;
  onLoaded: (
    studentId: string,
    history: StudentWrongWordHistory,
  ) => void;
  studentId: string;
}) {
  const [loading, setLoading] = useState(false);
  const requestingRef = useRef(false);
  const refreshAfterRequestRef = useRef(false);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [levelFilter, setLevelFilter] =
    useState<LevelFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState(initialDatasetId);
  const [query, setQuery] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<
    string[]
  >([]);
  const [worksheetSelectedQuestionIds, setWorksheetSelectedQuestionIds] =
    useState<string[]>([]);
  const [selectionPurpose, setSelectionPurpose] =
    useState<SelectionPurpose>("next_exam");
  const [queueing, setQueueing] = useState(false);
  const [worksheetRequesting, setWorksheetRequesting] =
    useState(false);
  const [readingCurriculumStage, setReadingCurriculumStage] =
    useState<ReadingCurriculumStage>(initialCurriculumStage);
  const [readingContextSyncStatus, setReadingContextSyncStatus] =
    useState(initialReadingContextSyncStatus);
  const [cancellingDraftId, setCancellingDraftId] = useState<
    string | null
  >(null);

  useEffect(() => {
    const cacheIsFresh =
      cachedHistory !== null &&
      cachedAt !== null &&
      Date.now() - cachedAt < WRONG_HISTORY_CACHE_TTL_MS;
    if (
      !active ||
      (cacheIsFresh && !forceRefresh) ||
      requestingRef.current
    ) {
      return;
    }
    const controller = new AbortController();
    requestingRef.current = true;
    setLoading(true);
    setError("");

    void fetch(`/api/admin/students/${studentId}/wrong-words`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          history?: StudentWrongWordHistory;
          error?: string;
        };
        if (!response.ok || !payload.history) {
          throw new Error(
            payload.error ??
              adminStudentsText.learning.wrongWordsPanel.loadError,
          );
        }
        onLoaded(studentId, payload.history);
        setForceRefresh(false);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : adminStudentsText.learning.wrongWordsPanel.loadError,
        );
        setForceRefresh(false);
      })
      .finally(() => {
        requestingRef.current = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (refreshAfterRequestRef.current) {
            refreshAfterRequestRef.current = false;
            setForceRefresh(true);
            setRequestVersion((value) => value + 1);
          }
        }
      });

    return () => {
      requestingRef.current = false;
      controller.abort();
    };
  }, [
    active,
    cachedAt,
    cachedHistory,
    forceRefresh,
    onLoaded,
    requestVersion,
    studentId,
  ]);

  function refreshHistory() {
    if (requestingRef.current) {
      refreshAfterRequestRef.current = true;
      return;
    }
    setForceRefresh(true);
    setRequestVersion((value) => value + 1);
  }

  const datasetOptions = useMemo(
    () => {
      const labelById = new Map<string, string>();
      for (const word of cachedHistory?.words ?? []) {
        for (const occurrence of word.occurrences) {
          if (!labelById.has(occurrence.datasetId)) {
            labelById.set(
              occurrence.datasetId,
              occurrence.datasetLabel,
            );
          }
        }
      }
      return [...labelById.entries()]
        .map(([id, label]) => ({ id, label }))
        .toSorted((left, right) =>
          left.label.localeCompare(right.label, "ko-KR"),
        );
    },
    [cachedHistory],
  );
  const datasetLabelById = useMemo(
    () =>
      new Map(
        datasetOptions.map((dataset) => [
          dataset.id,
          dataset.label,
        ]),
      ),
    [datasetOptions],
  );

  const pendingReviewActions = useMemo(() => {
    const activeDrafts = new Map<
      string,
      {
        datasetId: string;
        draftId: string;
        questionIds: string[];
      }
    >();
    for (const review of cachedHistory?.pendingReviews ?? []) {
      if (review.reviewDraftId) {
        const current = activeDrafts.get(review.reviewDraftId) ?? {
          datasetId: review.datasetId,
          draftId: review.reviewDraftId,
          questionIds: [],
        };
        current.questionIds.push(review.sourceQuestionId);
        activeDrafts.set(review.reviewDraftId, current);
      }
    }

    return {
      activeDrafts: [...activeDrafts.values()],
    };
  }, [cachedHistory]);

  const filteredWords = useMemo(
    () =>
      (cachedHistory?.words ?? []).filter((word) => {
        const levelMatches =
          levelFilter === "all" ||
          (levelFilter === "once" && word.wrongLevel === 1) ||
          (levelFilter === "repeated" && word.wrongLevel === 2);
        const datasetMatches =
          !datasetFilter ||
          word.occurrences.some(
            (occurrence) =>
              occurrence.datasetId === datasetFilter,
          );
        return (
          levelMatches &&
          datasetMatches &&
          matchesQuery(query, [
            word.headword,
            word.primaryMeaning,
            ...word.occurrences.map(
              (occurrence) => occurrence.datasetLabel,
            ),
          ])
        );
      }),
    [cachedHistory, datasetFilter, levelFilter, query],
  );

  const selectableFilteredQuestionIds = useMemo(
    () =>
      filteredWords.flatMap((word) => {
        const target = selectionTarget(word, datasetFilter);
        return target &&
          target.resolution === "unresolved" &&
          target.scheduling === "available"
          ? [target.questionId]
          : [];
      }),
    [datasetFilter, filteredWords],
  );
  const selectableFilteredQuestionIdSet = useMemo(
    () => new Set(selectableFilteredQuestionIds),
    [selectableFilteredQuestionIds],
  );
  const validSelectedQuestionIds = useMemo(
    () =>
      selectedQuestionIds.filter((questionId) =>
        selectableFilteredQuestionIdSet.has(questionId),
      ),
    [selectableFilteredQuestionIdSet, selectedQuestionIds],
  );
  const worksheetSelectableFilteredQuestionIds = useMemo(
    () =>
      filteredWords.flatMap((word) => {
        const target = worksheetSelectionTarget(word, datasetFilter);
        return target ? [target.questionId] : [];
      }),
    [datasetFilter, filteredWords],
  );
  const worksheetSelectableFilteredQuestionIdSet = useMemo(
    () => new Set(worksheetSelectableFilteredQuestionIds),
    [worksheetSelectableFilteredQuestionIds],
  );
  const validWorksheetSelectedQuestionIds = useMemo(
    () =>
      worksheetSelectedQuestionIds.filter((questionId) =>
        worksheetSelectableFilteredQuestionIdSet.has(questionId),
      ),
    [
      worksheetSelectableFilteredQuestionIdSet,
      worksheetSelectedQuestionIds,
    ],
  );
  const activeSelectableQuestionIds =
    selectionPurpose === "next_exam"
      ? selectableFilteredQuestionIds
      : worksheetSelectableFilteredQuestionIds.slice(0, 50);
  const activeSelectedQuestionIds =
    selectionPurpose === "next_exam"
      ? validSelectedQuestionIds
      : validWorksheetSelectedQuestionIds;
  const allVisibleSelected =
    activeSelectableQuestionIds.length > 0 &&
    activeSelectableQuestionIds.every((questionId) =>
      activeSelectedQuestionIds.includes(questionId),
    );

  function toggleQuestion(questionId: string) {
    if (
      requestingRef.current ||
      queueing ||
      worksheetRequesting ||
      cancellingDraftId
    ) {
      return;
    }
    if (selectionPurpose === "next_exam") {
      setSelectedQuestionIds((current) =>
        current.includes(questionId)
          ? current.filter((value) => value !== questionId)
          : [...current, questionId],
      );
      return;
    }
    setWorksheetSelectedQuestionIds((current) =>
      current.includes(questionId)
        ? current.filter((value) => value !== questionId)
        : current.length < 50
          ? [...current, questionId]
          : current,
    );
  }

  function toggleVisibleQuestions() {
    if (
      requestingRef.current ||
      queueing ||
      worksheetRequesting ||
      cancellingDraftId
    ) {
      return;
    }
    if (selectionPurpose === "next_exam") {
      setSelectedQuestionIds(
        allVisibleSelected ? [] : selectableFilteredQuestionIds,
      );
      return;
    }
    setWorksheetSelectedQuestionIds(
      allVisibleSelected ? [] : activeSelectableQuestionIds,
    );
  }

  function resetSelectionFeedback() {
    setSelectedQuestionIds([]);
    setWorksheetSelectedQuestionIds([]);
  }

  async function queueSelectedWords() {
    if (
      loading ||
      requestingRef.current ||
      queueing ||
      worksheetRequesting ||
      validSelectedQuestionIds.length === 0
    ) {
      return;
    }
    setQueueing(true);

    try {
      const response = await fetch(
        `/api/admin/students/${studentId}/wrong-words`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            questionIds: validSelectedQuestionIds,
          }),
        },
      );
      const payload = (await response.json()) as {
        queueIds?: string[];
        error?: string;
      };
      if (!response.ok || !payload.queueIds) {
        throw new Error(
          payload.error ??
            adminStudentsText.learning.wrongWordsPanel.queueError,
        );
      }
      toast.success(
        formatContentText(
          adminStudentsText.learning.wrongWordsPanel.queueSuccess,
          { count: payload.queueIds.length },
        ),
      );
      setSelectedQuestionIds([]);
      refreshHistory();
      onDataUpdated?.();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.queueError,
      );
      refreshHistory();
    } finally {
      setQueueing(false);
    }
  }

  async function createWorksheetRequest() {
    if (
      loading ||
      requestingRef.current ||
      queueing ||
      worksheetRequesting ||
      validWorksheetSelectedQuestionIds.length === 0 ||
      validWorksheetSelectedQuestionIds.length > 50
    ) {
      return;
    }

    setWorksheetRequesting(true);

    try {
      const response = await fetch(
        `/api/admin/students/${studentId}/worksheet-requests`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            questionIds: validWorksheetSelectedQuestionIds,
            curriculumStage: readingCurriculumStage,
          }),
        },
      );
      const payload = (await response.json()) as {
        request?: {
          itemCount: number;
          reused: boolean;
        };
        sync?: {
          status: "not_configured" | "synced" | "unchanged" | "failed";
          errorCode?: string;
        };
        error?: string;
      };
      if (!response.ok || !payload.request || !payload.sync) {
        throw new Error(
          payload.error ??
            adminStudentsText.learning.wrongWordsPanel.worksheetError,
        );
      }

      setReadingContextSyncStatus(
        payload.sync.status === "unchanged"
          ? "synced"
          : payload.sync.status,
      );
      onDataUpdated?.();
      if (payload.sync.status === "synced") {
        toast.success(
          formatContentText(
            adminStudentsText.learning.wrongWordsPanel.worksheetSuccess,
            { count: payload.request.itemCount },
          ),
        );
      } else if (payload.sync.status === "unchanged") {
        toast.info(
          adminStudentsText.learning.wrongWordsPanel.worksheetUnchanged,
        );
      } else if (payload.sync.status === "not_configured") {
        toast.warning(
          adminStudentsText.learning.wrongWordsPanel
            .worksheetDriveNotConfigured,
        );
      } else {
        toast.error(
          adminStudentsText.learning.wrongWordsPanel.worksheetDriveFailed,
        );
      }
      if (
        payload.sync.status === "synced" ||
        payload.sync.status === "unchanged"
      ) {
        setWorksheetSelectedQuestionIds([]);
      }
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.worksheetError,
      );
    } finally {
      setWorksheetRequesting(false);
    }
  }

  async function cancelReviewAssignmentDraft(draftId: string) {
    if (
      loading ||
      requestingRef.current ||
      queueing ||
      worksheetRequesting ||
      cancellingDraftId
    ) {
      return;
    }

    setCancellingDraftId(draftId);
    try {
      const response = await fetch(
        `/api/admin/students/${studentId}/review-assignment-drafts/${draftId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        status?: string;
        queueDisposition?: string;
        error?: string;
      };
      if (
        !response.ok ||
        payload.status !== "cancelled" ||
        payload.queueDisposition !== "pending"
      ) {
        throw new Error(
          payload.error ??
            adminStudentsText.learning.wrongWordsPanel.cancelDraftError,
        );
      }
      toast.success(
        adminStudentsText.learning.wrongWordsPanel.cancelDraftSuccess,
      );
      refreshHistory();
      onDataUpdated?.();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.cancelDraftError,
      );
    } finally {
      setCancellingDraftId(null);
    }
  }

  if (loading && !cachedHistory) {
    return (
      <section
        aria-busy="true"
        className="student-dialog-panel empty-state"
      >
        {adminStudentsText.learning.wrongWordsPanel.loading}
      </section>
    );
  }

  if (error && !cachedHistory) {
    return (
      <section className="student-dialog-panel">
        <div className="notice notice-error" role="alert">
          {error}
        </div>
        <Button
          onClick={refreshHistory}
        >
          {adminStudentsText.learning.wrongWordsPanel.retryLoad}
        </Button>
      </section>
    );
  }

  if (!cachedHistory) {
    return (
      <section className="student-dialog-panel empty-state">
        {adminStudentsText.learning.wrongWordsPanel.openToLoad}
      </section>
    );
  }

  return (
    <section className="student-dialog-panel wrong-word-panel">
      <div className="wrong-word-refresh-row">
        {loading ? (
          <span>{adminStudentsText.learning.wrongWordsPanel.refreshing}</span>
        ) : (
          <span className="label-with-help">
            {adminStudentsText.learning.wrongWordsPanel.refreshBasis}
            <HelpTip
              label={
                adminStudentsText.learning.wrongWordsPanel.refreshBasisHelpAria
              }
            >
              {adminStudentsText.learning.wrongHistoryRefreshHelp}
            </HelpTip>
          </span>
        )}
        <Button
          disabled={loading || queueing || worksheetRequesting}
          onClick={refreshHistory}
          size="small"
          variant="quiet"
        >
          {adminStudentsText.learning.wrongWordsPanel.refresh}
        </Button>
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="wrong-word-summary-grid">
        <div>
          <span>{adminStudentsText.learning.wrongWordsPanel.summary.event}</span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.times,
              { count: cachedHistory.wrongEventCount },
            )}
          </strong>
        </div>
        <div>
          <span>
            {adminStudentsText.learning.wrongWordsPanel.summary.current}
          </span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: cachedHistory.uniqueWordCount },
            )}
          </strong>
        </div>
        <div>
          <span>{adminStudentsText.learning.wrongWordsPanel.summary.once}</span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: cachedHistory.onceWrongWordCount },
            )}
          </strong>
        </div>
        <div>
          <span>
            {adminStudentsText.learning.wrongWordsPanel.summary.repeated}
          </span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: cachedHistory.repeatedWrongWordCount },
            )}
          </strong>
        </div>
        <div>
          <span>
            {adminStudentsText.learning.wrongWordsPanel.summary.pending}
          </span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: cachedHistory.pendingReviewCount },
            )}
          </strong>
        </div>
      </div>
      {pendingReviewActions.activeDrafts.length > 0 && (
        <div className="notice">
          <p>
            {adminStudentsText.learning.wrongWordsPanel.legacyDraftNotice}
          </p>
          {pendingReviewActions.activeDrafts.map((draft) => (
            <div className="wrong-word-draft-actions" key={draft.draftId}>
              <span>
                {formatContentText(
                  adminStudentsText.learning.wrongWordsPanel.draftSummary,
                  {
                    dataset:
                      datasetLabelById.get(draft.datasetId) ??
                      adminStudentsText.learning.wrongWordsPanel
                        .wordbookFallback,
                    count: draft.questionIds.length,
                  },
                )}
              </span>
              <Button
                aria-busy={cancellingDraftId === draft.draftId}
                disabled={
                  loading ||
                  queueing ||
                  worksheetRequesting ||
                  Boolean(cancellingDraftId)
                }
                onClick={() =>
                  void cancelReviewAssignmentDraft(draft.draftId)
                }
                size="small"
                variant="quiet"
              >
                {cancellingDraftId === draft.draftId
                  ? adminStudentsText.learning.wrongWordsPanel.canceling
                  : adminStudentsText.learning.wrongWordsPanel.cancelDraft}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div id="wrong-word-aggregate-panel">
          <div className="wrong-word-filter-grid">
            <label className="field">
              <span className="field-label">
                {adminStudentsText.learning.wrongWordsPanel.search}
              </span>
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetSelectionFeedback();
                }}
                placeholder={
                  adminStudentsText.learning.wrongWordsPanel.searchPlaceholder
                }
                type="search"
                value={query}
              />
            </label>
            <label className="field">
              <span className="field-label">
                {adminStudentsText.learning.wrongWordsPanel.wordbook}
              </span>
              <SelectField
                onChange={(event) => {
                  setDatasetFilter(event.target.value);
                  resetSelectionFeedback();
                }}
                value={datasetFilter}
              >
                <option value="">
                  {adminStudentsText.learning.wrongWordsPanel.allWordbooks}
                </option>
                {datasetOptions.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.label}
                  </option>
                ))}
              </SelectField>
            </label>
          </div>
          <div
            aria-label={
              adminStudentsText.learning.wrongWordsPanel.levelFilterAria
            }
            className="filter-chip-row"
          >
            {(
              [
                ["all", adminStudentsText.learning.wrongWordsPanel.all],
                ["once", adminStudentsText.learning.wrongWordsPanel.once],
                [
                  "repeated",
                  adminStudentsText.learning.wrongWordsPanel.repeated,
                ],
              ] as const
            ).map(([value, label]) => (
              <Button
                aria-pressed={levelFilter === value}
                className="filter-chip"
                key={value}
                onClick={() => {
                  if (levelFilter === value) {
                    return;
                  }
                  setLevelFilter(value);
                  resetSelectionFeedback();
                }}
                size="small"
                variant="quiet"
              >
                {label}
              </Button>
            ))}
          </div>
          <div
            aria-label={adminStudentsText.learning.wrongWordsPanel.purposeAria}
            className="filter-chip-row wrong-word-purpose-row"
            role="group"
          >
            {(
              [
                [
                  "next_exam",
                  adminStudentsText.learning.wrongWordsPanel.nextExam,
                ],
                [
                  "worksheet",
                  adminStudentsText.learning.wrongWordsPanel.worksheet,
                ],
              ] as const
            ).map(([value, label]) => (
              <Button
                aria-pressed={selectionPurpose === value}
                className="filter-chip"
                key={value}
                onClick={() => setSelectionPurpose(value)}
                size="small"
                variant="quiet"
              >
                {label}
              </Button>
            ))}
            <HelpTip
              label={
                adminStudentsText.learning.wrongWordsPanel.purposeHelpAria
              }
            >
              {selectionPurpose === "worksheet"
                ? adminStudentsText.learning.worksheetWrongWordHelp
                : adminStudentsText.learning.nextExamWrongWordHelp}
            </HelpTip>
          </div>
          <div className="wrong-word-selection-bar">
            {selectionPurpose === "worksheet" && (
              <label className="field wrong-word-curriculum-field">
                <span className="field-label">
                  {
                    adminStudentsText.learning.wrongWordsPanel
                      .readingCurriculum
                  }
                </span>
                <SelectField
                  onChange={(event) =>
                    setReadingCurriculumStage(
                      event.target.value as ReadingCurriculumStage,
                    )
                  }
                  value={readingCurriculumStage}
                >
                  {readingCurriculumStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {readingCurriculumStageLabel(stage)}
                    </option>
                  ))}
                </SelectField>
              </label>
            )}
            <Button
              disabled={
                queueing ||
                worksheetRequesting ||
                loading ||
                activeSelectableQuestionIds.length === 0
              }
              onClick={toggleVisibleQuestions}
              size="small"
              variant="quiet"
            >
              {allVisibleSelected
                ? adminStudentsText.learning.wrongWordsPanel.clearVisible
                : adminStudentsText.learning.wrongWordsPanel.selectVisible}
            </Button>
            <span
              aria-live="polite"
              className="wrong-word-selected-count"
            >
              {formatContentText(
                adminStudentsText.learning.wrongWordsPanel.selectedCount,
                { count: activeSelectedQuestionIds.length },
              )}
            </span>
            <div className="wrong-word-selection-actions">
              {selectionPurpose === "worksheet" ? (
                <Button
                  aria-busy={worksheetRequesting}
                  disabled={
                    loading ||
                    queueing ||
                    worksheetRequesting ||
                    validWorksheetSelectedQuestionIds.length === 0 ||
                    validWorksheetSelectedQuestionIds.length > 50
                  }
                  onClick={createWorksheetRequest}
                  size="small"
                >
                  {worksheetRequesting
                    ? adminStudentsText.learning.wrongWordsPanel
                        .worksheetPending
                    : adminStudentsText.learning.wrongWordsPanel
                        .addToWorksheet}
                </Button>
              ) : (
                <Button
                  aria-busy={queueing}
                  disabled={
                    loading ||
                    queueing ||
                    worksheetRequesting ||
                    validSelectedQuestionIds.length === 0
                  }
                  onClick={queueSelectedWords}
                  size="small"
                  variant="primary"
                >
                  {queueing
                    ? adminStudentsText.learning.wrongWordsPanel.queuePending
                    : adminStudentsText.learning.wrongWordsPanel.addToNextExam}
                </Button>
              )}
            </div>
            {selectionPurpose === "worksheet" && (
              <span
                className={`status-pill reading-context-status status-${readingContextSyncStatus}`}
              >
                {
                  adminStudentsText.learning.wrongWordsPanel
                    .readingContextStatus[readingContextSyncStatus]
                }
              </span>
            )}
          </div>

          {filteredWords.length === 0 ? (
            <div className="empty-state">
              {adminStudentsText.learning.wrongWordsPanel.empty}
            </div>
          ) : (
            <div className="wrong-word-list wrong-word-list-with-actions">
              {filteredWords.map((word) => {
                const nextExamTarget = selectionTarget(word, datasetFilter);
                const worksheetTarget = worksheetSelectionTarget(
                  word,
                  datasetFilter,
                );
                const activeTarget =
                  selectionPurpose === "next_exam"
                    ? nextExamTarget
                    : worksheetTarget;
                const selected = activeTarget
                  ? activeSelectedQuestionIds.includes(
                      activeTarget.questionId,
                    )
                  : false;
                return (
                <article
                  className="wrong-word-row"
                  data-selected={selected || undefined}
                  key={word.key}
                >
                  <label className="wrong-word-checkbox">
                    <input
                      checked={selected}
                      disabled={
                        !activeTarget ||
                        activeTarget.resolution === "resolved" ||
                        (selectionPurpose === "next_exam" &&
                          nextExamTarget?.scheduling !== "available") ||
                        (selectionPurpose === "worksheet" &&
                          !selected &&
                          validWorksheetSelectedQuestionIds.length >= 50) ||
                        loading ||
                        queueing ||
                        worksheetRequesting
                      }
                      onChange={() => {
                        if (activeTarget) {
                          toggleQuestion(activeTarget.questionId);
                        }
                      }}
                      type="checkbox"
                    />
                    <span className="sr-only">
                      {formatContentText(
                        adminStudentsText.learning.wrongWordsPanel.wordAria,
                        {
                          word: word.headword,
                          action:
                            selectionPurpose === "worksheet"
                              ? adminStudentsText.learning.wrongWordsPanel
                                  .addToWorksheet
                              : adminStudentsText.learning.wrongWordsPanel
                                  .addToNextExam,
                        },
                      )}
                    </span>
                  </label>
                  <div className="wrong-word-copy">
                    <strong>{word.headword}</strong>
                    <span>{word.primaryMeaning}</span>
                    <small>
                      {word.occurrences
                        .map(
                          (occurrence) => occurrence.datasetLabel,
                        )
                        .filter(
                          (value, index, values) =>
                            values.indexOf(value) === index,
                        )
                        .join(" · ")}
                    </small>
                  </div>
                  <div className="wrong-word-meta">
                    <span
                      className={`status-pill ${
                        nextExamTarget?.scheduling === "assigned" ||
                        nextExamTarget?.scheduling === "queued"
                          ? "status-completed"
                          : ""
                      }`}
                    >
                      {nextExamTarget?.resolution === "resolved"
                        ? adminStudentsText.learning.wrongWordsPanel.resolved
                        : nextExamTarget?.scheduling === "assigned"
                          ? adminStudentsText.learning.wrongWordsPanel.assigned
                          : nextExamTarget?.scheduling === "queued"
                            ? adminStudentsText.learning.wrongWordsPanel.pending
                            : adminStudentsText.learning.wrongWordsPanel
                                .available}
                    </span>
                    <span
                      className={`status-pill wrong-level-${word.wrongLevel}`}
                    >
                      {word.wrongLevel === 1
                        ? adminStudentsText.learning.wrongWordsPanel.once
                        : formatContentText(
                            adminStudentsText.learning.wrongWordsPanel
                              .wrongCount,
                            { count: word.wrongCount },
                          )}
                    </span>
                    <span>{outcomeLabel(word.latestOutcome)}</span>
                    <small>
                      {formatKoreanDateTime(word.lastWrongAt)}
                    </small>
                    {nextExamTarget?.activeAssignment && (
                      <small>{nextExamTarget.activeAssignment.title}</small>
                    )}
                  </div>
                </article>
                );
              })}
            </div>
          )}
      </div>
    </section>
  );
}
