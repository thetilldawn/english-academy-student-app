"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  type WrongWordAggregate,
  type StudentWrongWordHistory,
  type WrongWordOutcome,
} from "@/lib/admin/wrong-word-history";
import { formatKoreanDateTime } from "@/lib/format";

type LevelFilter = "all" | "once" | "repeated";
const WRONG_HISTORY_CACHE_TTL_MS = 30_000;

function outcomeLabel(outcome: WrongWordOutcome) {
  if (outcome === "recovered_on_retry") return "재시험에서 정답";
  if (outcome === "wrong_again") return "재시험에서도 오답";
  return "재시험 미응답";
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

export function StudentWrongWordPanel({
  active,
  cachedAt,
  cachedHistory,
  onLoaded,
  studentId,
}: {
  active: boolean;
  cachedAt: number | null;
  cachedHistory: StudentWrongWordHistory | null;
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
  const [datasetFilter, setDatasetFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<
    string[]
  >([]);
  const [queueing, setQueueing] = useState(false);
  const [cancellingDraftId, setCancellingDraftId] = useState<
    string | null
  >(null);
  const [queueError, setQueueError] = useState("");
  const [queueNotice, setQueueNotice] = useState("");

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
            payload.error ?? "오답 단어를 불러오지 못했습니다.",
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
            : "오답 단어를 불러오지 못했습니다.",
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
  const allVisibleSelected =
    selectableFilteredQuestionIds.length > 0 &&
    selectableFilteredQuestionIds.every((questionId) =>
      validSelectedQuestionIds.includes(questionId),
    );

  function toggleQuestion(questionId: string) {
    if (
      requestingRef.current ||
      queueing ||
      cancellingDraftId
    ) {
      return;
    }
    setSelectedQuestionIds((current) =>
      current.includes(questionId)
        ? current.filter((value) => value !== questionId)
        : [...current, questionId],
    );
    setQueueError("");
    setQueueNotice("");
  }

  function toggleVisibleQuestions() {
    if (
      requestingRef.current ||
      queueing ||
      cancellingDraftId
    ) {
      return;
    }
    setSelectedQuestionIds(
      allVisibleSelected ? [] : selectableFilteredQuestionIds,
    );
    setQueueError("");
    setQueueNotice("");
  }

  function resetSelectionFeedback() {
    setSelectedQuestionIds([]);
    setQueueError("");
    setQueueNotice("");
  }

  async function queueSelectedWords() {
    if (
      loading ||
      requestingRef.current ||
      queueing ||
      validSelectedQuestionIds.length === 0
    ) {
      return;
    }
    setQueueing(true);
    setQueueError("");
    setQueueNotice("");

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
            "오답 단어를 다음 시험 대기열에 추가하지 못했습니다.",
        );
      }
      setQueueNotice(
        `${payload.queueIds.length}개 단어를 다음 시험 대기열에 추가했습니다.`,
      );
      setSelectedQuestionIds([]);
      refreshHistory();
    } catch (requestError) {
      setQueueError(
        requestError instanceof Error
          ? requestError.message
          : "오답 단어를 다음 시험 대기열에 추가하지 못했습니다.",
      );
      refreshHistory();
    } finally {
      setQueueing(false);
    }
  }

  async function cancelReviewAssignmentDraft(draftId: string) {
    if (
      loading ||
      requestingRef.current ||
      queueing ||
      cancellingDraftId
    ) {
      return;
    }

    setCancellingDraftId(draftId);
    setQueueError("");
    setQueueNotice("");
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
          payload.error ?? "재시험 준비를 취소하지 못했습니다.",
        );
      }
      setQueueNotice(
        "재시험 준비를 취소했습니다. 오답은 다음 일반 시험 대기에 남아 있습니다.",
      );
      refreshHistory();
    } catch (requestError) {
      setQueueError(
        requestError instanceof Error
          ? requestError.message
          : "재시험 준비를 취소하지 못했습니다.",
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
        오답 단어를 불러오는 중…
      </section>
    );
  }

  if (error && !cachedHistory) {
    return (
      <section className="student-dialog-panel">
        <div className="notice notice-error" role="alert">
          {error}
        </div>
        <button
          className="button button-secondary"
          onClick={refreshHistory}
          type="button"
        >
          다시 불러오기
        </button>
      </section>
    );
  }

  if (!cachedHistory) {
    return (
      <section className="student-dialog-panel empty-state">
        오답 탭을 열면 이력을 불러옵니다.
      </section>
    );
  }

  return (
    <section className="student-dialog-panel wrong-word-panel">
      <div className="wrong-word-refresh-row">
        <span>
          {loading
            ? "최신 오답 이력을 확인하는 중…"
            : "첫 시험 종료 직후부터 오답을 반영합니다."}
        </span>
        <button
          className="button button-quiet button-small"
          disabled={loading || queueing}
          onClick={refreshHistory}
          type="button"
        >
          새로고침
        </button>
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="wrong-word-summary-grid">
        <div>
          <span>누적 오답</span>
          <strong>{cachedHistory.wrongEventCount}회</strong>
        </div>
        <div>
          <span>현재 오답 단어</span>
          <strong>{cachedHistory.uniqueWordCount}개</strong>
        </div>
        <div>
          <span>누적 1회</span>
          <strong>{cachedHistory.onceWrongWordCount}개</strong>
        </div>
        <div>
          <span>누적 2회 이상</span>
          <strong>{cachedHistory.repeatedWrongWordCount}개</strong>
        </div>
        <div>
          <span>다음 시험 대기</span>
          <strong>{cachedHistory.pendingReviewCount}개</strong>
        </div>
      </div>
      {pendingReviewActions.activeDrafts.length > 0 && (
        <div className="notice">
          <p>
            이전 방식으로 준비 중인 재시험이 있습니다. 취소하면 단어는
            다음 일반 시험 대기에 그대로 남습니다.
          </p>
          {pendingReviewActions.activeDrafts.map((draft) => (
            <div className="wrong-word-draft-actions" key={draft.draftId}>
              <span>
                {`${datasetLabelById.get(draft.datasetId) ?? "단어장"} · ${draft.questionIds.length}개`}
              </span>
              <button
                aria-busy={cancellingDraftId === draft.draftId}
                className="button button-quiet button-small"
                disabled={
                  loading ||
                  queueing ||
                  Boolean(cancellingDraftId)
                }
                onClick={() =>
                  void cancelReviewAssignmentDraft(draft.draftId)
                }
                type="button"
              >
                {cancellingDraftId === draft.draftId
                  ? "취소하는 중…"
                  : "재시험 준비 취소"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div id="wrong-word-aggregate-panel">
          <div className="wrong-word-filter-grid">
            <label className="field">
              <span className="field-label">단어 검색</span>
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetSelectionFeedback();
                }}
                placeholder="영어·뜻·단어장"
                type="search"
                value={query}
              />
            </label>
            <label className="field">
              <span className="field-label">단어장</span>
              <select
                onChange={(event) => {
                  setDatasetFilter(event.target.value);
                  resetSelectionFeedback();
                }}
                value={datasetFilter}
              >
                <option value="">전체 단어장</option>
                {datasetOptions.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            aria-label="오답 횟수 필터"
            className="filter-chip-row"
          >
            {(
              [
                ["all", "전체"],
                ["once", "누적 1회"],
                ["repeated", "누적 2회 이상"],
              ] as const
            ).map(([value, label]) => (
              <button
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
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="wrong-word-selection-bar">
            <button
              className="button button-quiet button-small"
              disabled={
                queueing ||
                loading ||
                selectableFilteredQuestionIds.length === 0
              }
              onClick={toggleVisibleQuestions}
              type="button"
            >
              {allVisibleSelected ? "보이는 선택 해제" : "보이는 단어 선택"}
            </button>
            <span aria-live="polite">
              {validSelectedQuestionIds.length}개 선택
            </span>
            <button
              aria-busy={queueing}
              className="button button-primary button-small"
              disabled={
                loading ||
                queueing ||
                validSelectedQuestionIds.length === 0
              }
              onClick={queueSelectedWords}
              type="button"
            >
              {queueing ? "추가하는 중…" : "다음 시험에 추가"}
            </button>
          </div>
          <p className="wrong-word-selection-help">
            선택한 단어는 다음 일반 시험에 추가할 수 있습니다.
          </p>
          {queueError && (
            <div className="notice notice-error" role="alert">
              {queueError}
            </div>
          )}
          {queueNotice && (
            <div
              aria-live="polite"
              className="notice notice-success"
              role="status"
            >
              {queueNotice}
            </div>
          )}

          {filteredWords.length === 0 ? (
            <div className="empty-state">
              조건에 맞는 오답 단어가 없습니다.
            </div>
          ) : (
            <div className="wrong-word-list wrong-word-list-with-actions">
              {filteredWords.map((word) => {
                const target = selectionTarget(word, datasetFilter);
                const selected = target
                  ? validSelectedQuestionIds.includes(
                      target.questionId,
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
                      checked={
                        selected ||
                        target?.scheduling === "queued" ||
                        target?.scheduling === "assigned"
                      }
                      disabled={
                        !target ||
                        target.resolution === "resolved" ||
                        target.scheduling !== "available" ||
                        loading ||
                        queueing
                      }
                      onChange={() => {
                        if (target) {
                          toggleQuestion(target.questionId);
                        }
                      }}
                      type="checkbox"
                    />
                    <span className="sr-only">
                      {word.headword} 오답 단어 선택
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
                        target?.scheduling === "assigned" ||
                        target?.scheduling === "queued"
                          ? "status-completed"
                          : ""
                      }`}
                    >
                      {target?.resolution === "resolved"
                        ? "해결됨"
                        : target?.scheduling === "assigned"
                          ? "배정 중"
                          : target?.scheduling === "queued"
                            ? "다음 시험 대기"
                            : "추가 가능"}
                    </span>
                    <span
                      className={`status-pill wrong-level-${word.wrongLevel}`}
                    >
                      {word.wrongLevel === 1
                        ? "누적 1회"
                        : `누적 ${word.wrongCount}회`}
                    </span>
                    <span>{outcomeLabel(word.latestOutcome)}</span>
                    <small>
                      {formatKoreanDateTime(word.lastWrongAt)}
                    </small>
                    {target?.activeAssignment && (
                      <small>{target.activeAssignment.title}</small>
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
