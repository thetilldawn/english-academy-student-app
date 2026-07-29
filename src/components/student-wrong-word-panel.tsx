"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  wrongWordReviewIdentity,
  type WrongWordAggregate,
  type StudentWrongWordHistory,
  type WrongWordOutcome,
} from "@/lib/admin/wrong-word-history";
import { formatKoreanDateTime } from "@/lib/format";

type ViewMode = "aggregate" | "attempts";
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
  const occurrence = datasetId
    ? word.occurrences.find(
        (candidate) => candidate.datasetId === datasetId,
      )
    : word.occurrences.find(
        (candidate) =>
          candidate.datasetId === word.latestDatasetId &&
          candidate.vocabEntryId === word.latestVocabEntryId,
      );
  const selectedOccurrence = occurrence ?? word.occurrences[0];
  if (!selectedOccurrence) return null;
  return {
    questionId: selectedOccurrence.latestQuestionId,
    reviewKey: wrongWordReviewIdentity(
      selectedOccurrence.datasetId,
      selectedOccurrence.vocabEntryId,
      word.canonicalLexemeId,
    ),
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
  const [viewMode, setViewMode] = useState<ViewMode>("aggregate");
  const [levelFilter, setLevelFilter] =
    useState<LevelFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<
    string[]
  >([]);
  const [queueing, setQueueing] = useState(false);
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

  function moveViewTabFocus(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
        event.key,
      )
    ) {
      return;
    }
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      ) ?? [],
    );
    if (tabs.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(
      tabs.indexOf(event.currentTarget),
      0,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
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

  const pendingReviewKeys = useMemo(
    () =>
      new Set(
        (cachedHistory?.pendingReviews ?? []).map(
          (review) => review.key,
        ),
      ),
    [cachedHistory],
  );

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
        return target && !pendingReviewKeys.has(target.reviewKey)
          ? [target.questionId]
          : [];
      }),
    [datasetFilter, filteredWords, pendingReviewKeys],
  );
  const selectableQuestionIdSet = useMemo(
    () =>
      new Set(
        (cachedHistory?.words ?? []).flatMap((word) =>
          word.occurrences.flatMap((occurrence) => {
            const reviewKey = wrongWordReviewIdentity(
              occurrence.datasetId,
              occurrence.vocabEntryId,
              word.canonicalLexemeId,
            );
            return pendingReviewKeys.has(reviewKey)
              ? []
              : [occurrence.latestQuestionId];
          }),
        ),
      ),
    [cachedHistory, pendingReviewKeys],
  );
  const validSelectedQuestionIds = useMemo(
    () =>
      selectedQuestionIds.filter((questionId) =>
        selectableQuestionIdSet.has(questionId),
      ),
    [selectableQuestionIdSet, selectedQuestionIds],
  );
  const allVisibleSelected =
    selectableFilteredQuestionIds.length > 0 &&
    selectableFilteredQuestionIds.every((questionId) =>
      validSelectedQuestionIds.includes(questionId),
    );

  function toggleQuestion(questionId: string) {
    if (requestingRef.current || queueing) return;
    setSelectedQuestionIds((current) =>
      validSelectedQuestionIds.includes(questionId)
        ? current.filter((value) => value !== questionId)
        : [...current, questionId],
    );
    setQueueError("");
    setQueueNotice("");
  }

  function toggleVisibleQuestions() {
    if (requestingRef.current || queueing) return;
    const visible = new Set(selectableFilteredQuestionIds);
    setSelectedQuestionIds(
      allVisibleSelected
        ? validSelectedQuestionIds.filter(
            (questionId) => !visible.has(questionId),
          )
        : [
            ...new Set([
              ...validSelectedQuestionIds,
              ...selectableFilteredQuestionIds,
            ]),
          ],
    );
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
    } finally {
      setQueueing(false);
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
            : "완료되거나 시간 종료된 시험만 반영합니다."}
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
          <span>오답 단어</span>
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

      <div
        aria-label="오답 보기 방식"
        className="dialog-tabs"
        role="tablist"
      >
        <button
          aria-controls="wrong-word-aggregate-panel"
          aria-selected={viewMode === "aggregate"}
          className="dialog-tab"
          id="wrong-word-aggregate-tab"
          onKeyDown={moveViewTabFocus}
          onClick={() => setViewMode("aggregate")}
          role="tab"
          tabIndex={viewMode === "aggregate" ? 0 : -1}
          type="button"
        >
          종합
        </button>
        <button
          aria-controls="wrong-word-attempt-panel"
          aria-selected={viewMode === "attempts"}
          className="dialog-tab"
          id="wrong-word-attempt-tab"
          onKeyDown={moveViewTabFocus}
          onClick={() => setViewMode("attempts")}
          role="tab"
          tabIndex={viewMode === "attempts" ? 0 : -1}
          type="button"
        >
          시험별
        </button>
      </div>

      {viewMode === "aggregate" ? (
        <div
          aria-labelledby="wrong-word-aggregate-tab"
          id="wrong-word-aggregate-panel"
          role="tabpanel"
        >
          <div className="wrong-word-filter-grid">
            <label className="field">
              <span className="field-label">단어 검색</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="영어·뜻·단어장"
                type="search"
                value={query}
              />
            </label>
            <label className="field">
              <span className="field-label">단어장</span>
              <select
                onChange={(event) =>
                  setDatasetFilter(event.target.value)
                }
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
                onClick={() => setLevelFilter(value)}
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
            선택한 단어는 다음 새 단어시험을 배정할 때 포함할 목록에
            저장됩니다.
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
            <div className="wrong-word-list">
              {filteredWords.map((word) => {
                const target = selectionTarget(word, datasetFilter);
                const pending = target
                  ? pendingReviewKeys.has(target.reviewKey)
                  : false;
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
                      checked={pending || selected}
                      disabled={
                        !target || pending || loading || queueing
                      }
                      onChange={() => {
                        if (target) {
                          toggleQuestion(target.questionId);
                        }
                      }}
                      type="checkbox"
                    />
                    <span className="sr-only">
                      {word.headword} 다음 시험에 추가
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
                    {pending && (
                      <span className="status-pill status-completed">
                        추가됨
                      </span>
                    )}
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
                  </div>
                </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div
          aria-labelledby="wrong-word-attempt-tab"
          id="wrong-word-attempt-panel"
          role="tabpanel"
        >
          {cachedHistory.attempts.length === 0 ? (
            <div className="empty-state">오답 시험이 없습니다.</div>
          ) : (
            <div className="wrong-attempt-list">
              {cachedHistory.attempts.map((attempt) => (
                <details
                  className="wrong-attempt-row"
                  key={attempt.attemptId}
                >
                  <summary>
                    <span>
                      <strong>{attempt.assignmentTitle}</strong>
                      <small>
                        {attempt.attemptNumber}회 ·{" "}
                        {formatKoreanDateTime(attempt.completedAt)}
                      </small>
                    </span>
                    <span>
                      {attempt.words.length}개 단어 · 오답{" "}
                      {attempt.wrongEventCount}회
                    </span>
                  </summary>
                  <div className="wrong-attempt-words">
                    {attempt.words.map((word) => (
                      <div
                        className="wrong-attempt-word"
                        key={word.questionId}
                      >
                        <span>
                          <strong>{word.headword}</strong>
                          <small>{word.primaryMeaning}</small>
                        </span>
                        <span>
                          {outcomeLabel(word.outcome)} ·{" "}
                          {word.datasetLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
