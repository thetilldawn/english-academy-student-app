"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import type {
  AssignmentActivityStatus,
  AssignmentHistorySummary,
} from "@/lib/admin/history";
import {
  assignmentOrderLabel,
  assignmentScopeLabel,
} from "@/lib/admin/history";
import { DeadlineCountdown } from "@/components/deadline-countdown";
import {
  currentTimeMilliseconds,
  secondsUntil,
} from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

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

const STATUS_LABELS: Record<AssignmentActivityStatus, string> = {
  not_started: "응시 전",
  missed: "미응시 마감",
  in_progress: "응시 중",
  completed: "완료",
  expired: "시간 종료",
};

function statusLabel(item: AssignmentHistorySummary) {
  return item.status === "in_progress" && item.phase === "review"
    ? "첫 시험 결과"
    : STATUS_LABELS[item.status];
}

function scoreText(score: number | null) {
  return score === null ? "-" : `${score}점`;
}

function directionLabel(ratio: number) {
  if (ratio === 100) return "영어 → 뜻";
  if (ratio === 0) return "뜻 → 영어";
  return "영어 ↔ 뜻 혼합";
}

function elapsedText(seconds: number | null) {
  if (seconds === null) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}분 ${remainder}초`;
}

export function AdminHistoryList({
  items,
  compact = false,
  showFilters = false,
}: {
  items: AssignmentHistorySummary[];
  compact?: boolean;
  showFilters?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailRequestRef = useRef<AbortController | null>(null);
  const [selected, setSelected] =
    useState<AssignmentHistorySummary | null>(null);
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDeadlineRemaining, setSelectedDeadlineRemaining] =
    useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | AssignmentActivityStatus
  >("all");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return items.filter((item) => {
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;
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
    });
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
    setSelected(item);
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
            payload.error ?? "응시 상세를 불러오지 못했습니다.",
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
            : "응시 상세를 불러오지 못했습니다.",
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
      {showFilters && (
        <div className="history-filters">
          <label className="field">
            <span className="field-label">학생·시험 검색</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="학생, 학교, 시험, DAY"
              type="search"
              value={query}
            />
          </label>
          <label className="field">
            <span className="field-label">상태</span>
            <select
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as
                    | "all"
                    | AssignmentActivityStatus,
                )
              }
              value={statusFilter}
            >
              <option value="all">전체</option>
              <option value="not_started">응시 전</option>
              <option value="missed">미응시 마감</option>
              <option value="in_progress">응시 중</option>
              <option value="completed">완료</option>
              <option value="expired">시간 종료</option>
            </select>
          </label>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="empty-state">
          {items.length === 0
            ? "아직 배정된 시험이 없습니다."
            : "조건에 맞는 내역이 없습니다."}
        </div>
      ) : (
        <ol className="admin-history-list">
          {filteredItems.map((item) => (
            <li key={item.id}>
              <button
                className="admin-history-row"
                data-compact={compact}
                onClick={() => openHistory(item)}
                type="button"
              >
                <span className="history-row-main">
                  <strong>{item.studentName}</strong>
                  <span>{item.assignmentTitle}</span>
                  <small>
                    {assignmentScopeLabel(item)} ·{" "}
                    {item.status === "missed"
                      ? `마감 ${formatKoreanDateTime(
                          item.availableUntil,
                        )}`
                      : item.status === "not_started"
                        ? `배정 ${formatKoreanDateTime(
                            item.assignedAt,
                          )}`
                        : `시작 ${formatKoreanDateTime(
                            item.startedAt,
                          )}`}
                  </small>
                </span>
                <span className="history-score-pair">
                  <span>
                    첫 시험
                    <strong>{scoreText(item.initialScore)}</strong>
                  </span>
                  <span>
                    최종
                    <strong>{scoreText(item.finalScore)}</strong>
                  </span>
                </span>
                <span
                  className={`status-pill status-${item.status}`}
                >
                  {statusLabel(item)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {selected && (
        <dialog
          aria-labelledby="history-dialog-title"
          className="dialog dialog-wide history-dialog"
          onClick={closeOnBackdrop}
          onClose={() => {
            detailRequestRef.current?.abort();
            setSelected(null);
            setDetail(null);
            setDetailError("");
            setSelectedDeadlineRemaining(null);
          }}
          ref={dialogRef}
        >
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">시험 내역</p>
              <h2 id="history-dialog-title">{selected.studentName}</h2>
              <p>{selected.assignmentTitle}</p>
            </div>
            <button
              aria-label="닫기"
              className="button button-quiet button-small"
              onClick={closeDialog}
              type="button"
            >
              닫기
            </button>
          </div>

          <div className="history-dialog-scores">
            <div>
              <span>상태</span>
              <strong>{statusLabel(selected)}</strong>
            </div>
            <div>
              <span>첫 시험 점수</span>
              <strong>{scoreText(selected.initialScore)}</strong>
            </div>
            <div>
              <span>재시험 반영 점수</span>
              <strong>{scoreText(selected.finalScore)}</strong>
            </div>
            <div>
              <span>
                {selected.status === "not_started" ||
                selected.status === "missed"
                  ? "배정 상태"
                  : "다시 볼 단어"}
              </span>
              <strong>
                {selected.status === "not_started"
                  ? "응시 전"
                  : selected.status === "missed"
                    ? "마감까지 시작 안 함"
                  : `${selected.unresolvedWrongCount ?? "-"}개`}
              </strong>
            </div>
          </div>

          <dl className="history-dialog-details">
            <div>
              <dt>단어장</dt>
              <dd>{selected.datasetTitle}</dd>
            </div>
            <div>
              <dt>범위</dt>
              <dd>{assignmentScopeLabel(selected)}</dd>
            </div>
            <div>
              <dt>조건</dt>
              <dd>
                {selected.questionCount}문항 ·{" "}
                {Math.ceil(selected.timeLimitSeconds / 60)}분 ·{" "}
                {selected.passingScore}점
              </dd>
            </div>
            <div>
              <dt>출제·순서</dt>
              <dd>
                {directionLabel(selected.englishToKoreanRatio)} ·{" "}
                {assignmentOrderLabel(
                  selected.assignmentPurpose,
                  selected.questionOrderMode,
                )}
              </dd>
            </div>
            <div>
              <dt>배정</dt>
              <dd>{formatKoreanDateTime(selected.assignedAt)}</dd>
            </div>
            <div>
              <dt>응시 시작 마감</dt>
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
              <dt>종료</dt>
              <dd>
                {selected.completedAt
                  ? formatKoreanDateTime(selected.completedAt)
                  : "-"}
              </dd>
            </div>
          </dl>

          {detailLoading && (
            <div className="dialog-loading" role="status">
              응시 문항을 불러오는 중…
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
                <h3>문항 요약</h3>
                <span className="detail-chip">
                  오답 {wrongQuestions.length}개 · 미응답{" "}
                  {unansweredQuestions.length}개 ·{" "}
                  {elapsedText(detail.elapsedSeconds)}
                </span>
              </div>
              {wrongQuestions.length === 0 ? (
                <p className="list-meta">
                  {unansweredQuestions.length > 0
                    ? `아직 답하지 않은 문항이 ${unansweredQuestions.length}개 있습니다.`
                    : "첫 시험에서 모두 맞았습니다."}
                </p>
              ) : (
                <ul>
                  {wrongQuestions.slice(0, 8).map((question) => (
                    <li key={question.id}>
                      <strong>{question.prompt}</strong>
                      <span>
                        {question.initialChoice ?? "선택 안 함"} →{" "}
                        {question.correctAnswer}
                        {" · "}
                        {question.retryIsCorrect === true
                          ? "재시험 정답"
                          : question.retryIsCorrect === false
                            ? "재시험 오답"
                            : "재시험 없음"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {wrongQuestions.length > 8 && (
                <p className="list-meta">
                  처음 8개만 표시합니다. 전체 문항은 상세 내역에서
                  확인할 수 있습니다.
                </p>
              )}
            </section>
          )}

          <div className="dialog-actions">
            {selected.attemptId && (
              <Link
                className="button button-primary"
                href={`/admin/results/${selected.attemptId}`}
              >
                상세 내역 보기
              </Link>
            )}
            <Link
              className="button button-secondary"
              href={`/admin/students?student=${selected.studentId}`}
            >
              학생 관리
            </Link>
            <button
              className="button button-quiet"
              onClick={closeDialog}
              type="button"
            >
              닫기
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
