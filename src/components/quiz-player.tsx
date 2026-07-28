"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

type Question = {
  id: string;
  orderIndex: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
  initialChoiceIndex: number | null;
  initialIsCorrect: boolean | null;
  retryChoiceIndex: number | null;
  retryIsCorrect: boolean | null;
  revealedCorrectChoiceIndex: number | null;
};

type Attempt = {
  id: string;
  assignmentTitle: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "retry" | "completed";
  startedAt: string;
  deadlineAt: string;
  questions: Question[];
  currentQuestionId: string | null;
};

type AnswerResponse = {
  correct?: boolean;
  correctChoiceIndex?: number;
  completed?: boolean;
  needsRetry?: boolean;
  expired?: boolean;
  error?: string;
};

type AttemptResponse = {
  attempt?: Attempt;
  error?: string;
};

function secondsUntil(deadlineAt: string) {
  return Math.max(
    0,
    Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000),
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function QuizPlayer({ initialAttempt }: { initialAttempt: Attempt }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(initialAttempt);
  const [remaining, setRemaining] = useState(() =>
    secondsUntil(initialAttempt.deadlineAt),
  );
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [correctChoice, setCorrectChoice] = useState<number | null>(null);
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [timeWarning, setTimeWarning] = useState("");
  const expireStarted = useRef(false);
  const timeWarningAnnounced = useRef(false);
  const promptRef = useRef<HTMLHeadingElement>(null);

  const currentQuestion = useMemo(
    () =>
      attempt.questions.find(
        (question) => question.id === attempt.currentQuestionId,
      ) ?? null,
    [attempt],
  );

  const phaseQuestions = useMemo(
    () =>
      attempt.phase === "retry"
        ? attempt.questions.filter(
            (question) => question.initialIsCorrect === false,
          )
        : attempt.questions,
    [attempt],
  );
  const completedInPhase = phaseQuestions.filter((question) =>
    attempt.phase === "retry"
      ? question.retryChoiceIndex !== null
      : question.initialChoiceIndex !== null,
  ).length;
  const progress =
    phaseQuestions.length === 0
      ? 100
      : Math.round((completedInPhase / phaseQuestions.length) * 100);

  const refreshAttempt = useCallback(async () => {
    const response = await fetch(`/api/student/attempts/${attempt.id}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as AttemptResponse;
    if (!response.ok || !payload.attempt) {
      throw new Error(payload.error ?? "시험 상태를 불러오지 못했습니다.");
    }
    setAttempt(payload.attempt);
    setRemaining(secondsUntil(payload.attempt.deadlineAt));
    return payload.attempt;
  }, [attempt.id]);

  const expireAttempt = useCallback(async () => {
    if (expireStarted.current) return;
    expireStarted.current = true;
    try {
      await fetch(`/api/student/attempts/${attempt.id}/expire`, {
        method: "POST",
      });
    } finally {
      router.replace(`/student/result/${attempt.id}`);
      router.refresh();
    }
  }, [attempt.id, router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(secondsUntil(attempt.deadlineAt));
    }, 500);
    return () => window.clearInterval(timer);
  }, [attempt.deadlineAt]);

  useEffect(() => {
    if (
      remaining === 0 &&
      attempt.status === "in_progress"
    ) {
      void expireAttempt();
    }
  }, [attempt.status, expireAttempt, remaining]);

  useEffect(() => {
    if (
      remaining > 0 &&
      remaining <= 30 &&
      !timeWarningAnnounced.current
    ) {
      timeWarningAnnounced.current = true;
      setTimeWarning("남은 시간이 30초입니다.");
    }
  }, [remaining]);

  const submitChoice = useCallback(
    async (choiceIndex: number) => {
      if (!currentQuestion || submitting || answerCorrect !== null) return;

      setSubmitting(true);
      setError("");
      setSelectedChoice(choiceIndex);
      try {
        const response = await fetch(
          `/api/student/attempts/${attempt.id}/answers`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              questionId: currentQuestion.id,
              phase: attempt.phase,
              choiceIndex,
            }),
          },
        );
        const payload = (await response.json()) as AnswerResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "답안을 저장하지 못했습니다.");
        }
        if (payload.expired) {
          router.replace(`/student/result/${attempt.id}`);
          router.refresh();
          return;
        }

        setAnswerCorrect(Boolean(payload.correct));
        setCorrectChoice(
          typeof payload.correctChoiceIndex === "number"
            ? payload.correctChoiceIndex
            : null,
        );

        window.setTimeout(async () => {
          if (payload.completed) {
            router.replace(`/student/result/${attempt.id}`);
            router.refresh();
            return;
          }

          try {
            const nextAttempt = await refreshAttempt();
            if (nextAttempt.status !== "in_progress") {
              router.replace(`/student/result/${attempt.id}`);
              router.refresh();
              return;
            }
            setSelectedChoice(null);
            setCorrectChoice(null);
            setAnswerCorrect(null);
          } catch (refreshError) {
            setError(
              refreshError instanceof Error
                ? refreshError.message
                : "다음 문제를 불러오지 못했습니다.",
            );
          } finally {
            setSubmitting(false);
          }
        }, 800);
      } catch (requestError) {
        setSelectedChoice(null);
        setCorrectChoice(null);
        setAnswerCorrect(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "답안을 저장하지 못했습니다.",
        );
        setSubmitting(false);
      }
    },
    [
      answerCorrect,
      attempt.id,
      attempt.phase,
      currentQuestion,
      refreshAttempt,
      router,
      submitting,
    ],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const choiceIndex = Number(event.key) - 1;
      if (choiceIndex >= 0 && choiceIndex <= 3) {
        event.preventDefault();
        void submitChoice(choiceIndex);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [submitChoice]);

  useEffect(() => {
    promptRef.current?.focus();
  }, [currentQuestion?.id]);

  if (!currentQuestion) {
    return (
      <section className="quiz-card">
        <div className="empty-state">
          시험 상태를 정리하는 중입니다.
        </div>
      </section>
    );
  }

  return (
    <section className="quiz-card">
      <div className="quiz-topline">
        <div>
          <p className="quiz-phase">
            {attempt.phase === "retry" ? "오답 다시 풀기" : "첫 풀이"}
          </p>
          <strong>{attempt.assignmentTitle}</strong>
        </div>
        <span
          aria-label={`남은 시간 ${formatTime(remaining)}`}
          className={`timer ${remaining <= 30 ? "timer-warning" : ""}`}
        >
          {formatTime(remaining)}
        </span>
      </div>

      <div
        aria-label={`진행률 ${progress}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="progress-track"
        role="progressbar"
      >
        <div className="progress-value" style={{ width: `${progress}%` }} />
      </div>

      <p className="quiz-direction">
        {attempt.phase === "retry"
          ? `다시 풀기 ${completedInPhase + 1}/${phaseQuestions.length}`
          : `${currentQuestion.orderIndex}/${attempt.questions.length}`}
        {" · "}
        {currentQuestion.direction === "english_to_korean"
          ? "알맞은 뜻을 고르세요"
          : "알맞은 영어 단어를 고르세요"}
      </p>
      <h1
        className="quiz-prompt"
        id="quiz-prompt"
        ref={promptRef}
        tabIndex={-1}
      >
        {currentQuestion.prompt}
      </h1>

      <div
        aria-labelledby="quiz-prompt"
        className="choice-list"
        role="group"
      >
        {currentQuestion.choices.map((choice, index) => {
          const classNames = ["choice"];
          if (correctChoice === index) classNames.push("choice-correct");
          if (
            selectedChoice === index &&
            answerCorrect === false &&
            correctChoice !== index
          ) {
            classNames.push("choice-wrong");
          }

          return (
            <button
              className={classNames.join(" ")}
              disabled={submitting || answerCorrect !== null}
              key={`${currentQuestion.id}:${index}`}
              onClick={() => void submitChoice(index)}
              type="button"
            >
              <span className="choice-number">{index + 1}</span>
              {choice}
            </button>
          );
        })}
      </div>

      <div
        aria-atomic="true"
        aria-live="assertive"
        className={[
          "feedback",
          answerCorrect === true ? "feedback-correct" : "",
          answerCorrect === false ? "feedback-wrong" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="alert"
      >
        {answerCorrect === true && "정답입니다."}
        {answerCorrect === false &&
          (attempt.phase === "initial"
            ? "오답입니다. 첫 풀이 뒤 한 번 더 나옵니다."
            : "다시 확인할 단어로 남겼습니다.")}
      </div>
      {error && (
        <div className="inline-error quiz-error" role="alert">
          {error}
        </div>
      )}
      <span aria-live="assertive" className="sr-only" role="status">
        {timeWarning}
      </span>
      <p className="keyboard-hint">키보드 1~4로도 빠르게 선택할 수 있습니다.</p>
    </section>
  );
}
