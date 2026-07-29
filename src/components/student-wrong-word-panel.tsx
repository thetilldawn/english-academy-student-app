"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type {
  StudentWrongWordHistory,
  WrongWordOutcome,
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
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("aggregate");
  const [levelFilter, setLevelFilter] =
    useState<LevelFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState("");
  const [query, setQuery] = useState("");

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
        if (!controller.signal.aborted) setLoading(false);
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
    if (requestingRef.current) return;
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
    () =>
      Array.from(
        new Set(
          (cachedHistory?.words ?? []).flatMap((word) =>
            word.occurrences.map(
              (occurrence) => occurrence.datasetLabel,
            ),
          ),
        ),
      ).toSorted((left, right) =>
        left.localeCompare(right, "ko-KR"),
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
              occurrence.datasetLabel === datasetFilter,
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
          disabled={loading}
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
                  <option key={dataset} value={dataset}>
                    {dataset}
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

          {filteredWords.length === 0 ? (
            <div className="empty-state">
              조건에 맞는 오답 단어가 없습니다.
            </div>
          ) : (
            <div className="wrong-word-list">
              {filteredWords.map((word) => (
                <article className="wrong-word-row" key={word.key}>
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
              ))}
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
