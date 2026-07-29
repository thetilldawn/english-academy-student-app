"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";

import type { ReviewAssignmentDraftSummary } from "@/lib/admin/review-assignment";
import {
  currentTimeMilliseconds,
  koreanDateTimeLocalToIso,
} from "@/lib/deadline";
import { formatKoreanDateTime } from "@/lib/format";

type ErrorResponse = {
  error?: string;
};

function directionLabel(ratio: 0 | 50 | 100) {
  if (ratio === 100) return "영어 → 뜻";
  if (ratio === 0) return "뜻 → 영어";
  return "영어 ↔ 뜻 혼합";
}

export function ReviewAssignmentDialog({
  draft,
}: {
  draft: ReviewAssignmentDraftSummary;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [directionRatio, setDirectionRatio] = useState<0 | 50 | 100>(50);
  const [questionOrderMode, setQuestionOrderMode] = useState<
    "fixed" | "random"
  >("random");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(5);
  const [passingScore, setPassingScore] = useState(80);
  const [availableUntilLocal, setAvailableUntilLocal] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, []);

  const timeLimitSeconds = timeLimitMinutes * 60;
  const cannotCreate =
    submitting ||
    timeLimitSeconds < 30 ||
    timeLimitSeconds > 10800 ||
    Date.parse(draft.expiresAt) <= currentTimeMilliseconds();

  function leaveDraft() {
    if (submitting) return;
    dialogRef.current?.close();
    router.replace("/admin/assignments");
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) leaveDraft();
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
      setError("응시 시작 마감은 현재보다 뒤의 한국시간으로 정해주세요.");
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
          <p className="eyebrow">오답 재시험 배정</p>
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
          disabled={submitting}
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
              <h3>고정된 재시험 대상</h3>
              <p>
                학생·단어장·문항 수는 선택한 오답으로 고정됩니다.
              </p>
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
              <h3>문제 조건</h3>
              <p>출제 방향·순서·시간과 통과 기준을 정합니다.</p>
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
                    event.target.value as "fixed" | "random",
                  )
                }
                value={questionOrderMode}
              >
                <option value="random">무작위</option>
                <option value="fixed">선택 순서</option>
              </select>
              <span className="field-help">
                문제와 보기는 한 번 만들고 학생이 볼 문항 순서만
                설정합니다.
              </span>
            </label>
          </div>
          <div className="form-grid-2">
            <label className="field">
              <span className="field-label">
                시험 단계별 제한 시간(분)
              </span>
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
          <label className="field">
            <span className="field-label">
              응시 시작 마감 · 선택 · 한국시간
            </span>
            <input
              onChange={(event) =>
                setAvailableUntilLocal(event.target.value)
              }
              step={60}
              type="datetime-local"
              value={availableUntilLocal}
            />
          </label>
        </section>

        <section className="assignment-step assignment-review-step">
          <div className="assignment-step-heading">
            <span>3</span>
            <div>
              <h3>확인하고 배정</h3>
              <p>시험 이름은 자동 생성하며 필요할 때만 바꿉니다.</p>
            </div>
          </div>
          <label className="field">
            <span className="field-label">시험 이름 변경 · 선택</span>
            <input
              maxLength={160}
              onChange={(event) => setCustomTitle(event.target.value)}
              placeholder={draft.generatedTitle}
              value={customTitle}
            />
          </label>
          <div className="assignment-review-summary">
            <strong>{customTitle.trim() || draft.generatedTitle}</strong>
            <dl>
              <div>
                <dt>출제</dt>
                <dd>{directionLabel(directionRatio)}</dd>
              </div>
              <div>
                <dt>순서</dt>
                <dd>
                  {questionOrderMode === "random"
                    ? "무작위"
                    : "선택 순서"}
                </dd>
              </div>
              <div>
                <dt>조건</dt>
                <dd>
                  {draft.questionCount}문항 · {timeLimitMinutes}분 ·{" "}
                  {passingScore}점
                </dd>
              </div>
              <div>
                <dt>응시 시작 마감</dt>
                <dd>
                  {availableUntilLocal
                    ? `${availableUntilLocal.replace("T", " ")} · 한국시간`
                    : "마감 없음"}
                </dd>
              </div>
            </dl>
          </div>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button button-primary button-large"
            disabled={cannotCreate}
            type="submit"
          >
            {submitting ? "배정하는 중…" : "오답 재시험 배정"}
          </button>
        </section>
      </form>
    </dialog>
  );
}
