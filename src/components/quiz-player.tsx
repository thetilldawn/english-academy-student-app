"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { HelpTip } from "@/components/help-tip";
import { studentAppText } from "@/content/ko/student-app";
import { formatContentText } from "@/content/format";
import {
  currentTimeMilliseconds,
  secondsUntil,
} from "@/lib/deadline";
import type { QuizDirection } from "@/lib/quiz/engine";
import { getPriorWrongIndicator } from "@/lib/quiz/prior-wrong";
import {
  allChoiceAudioAvailable,
  type QuizPronunciation,
} from "@/lib/quiz/pronunciation-snapshot";

const ANSWER_FEEDBACK_DELAY_MS = 500;

type Question = {
  id: string;
  orderIndex: number;
  direction: QuizDirection;
  prompt: string;
  choices: string[];
  pronunciation: QuizPronunciation;
  choicePronunciations: QuizPronunciation[];
  initialChoiceIndex: number | null;
  initialIsCorrect: boolean | null;
  retryChoiceIndex: number | null;
  retryIsCorrect: boolean | null;
  priorWrongLevel: 0 | 1 | 2;
  initialTimedOut: boolean;
  retryTimedOut: boolean;
  revealedCorrectChoiceIndex: number | null;
};

type Attempt = {
  id: string;
  assignmentTitle: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  startedAt: string;
  deadlineAt: string;
  timerDeadlineAt: string;
  timingMode: "total" | "per_question";
  questionTimeLimitSeconds: number | null;
  questions: Question[];
  currentQuestionId: string | null;
};

type AnswerResponse = {
  correct?: boolean;
  correctChoiceIndex?: number;
  completed?: boolean;
  needsRetry?: boolean;
  expired?: boolean;
  nextQuestionId?: string | null;
  nextPhase?: "initial" | "retry" | null;
  initialAnsweredCount?: number;
  initialQuestionCount?: number;
  retryAnsweredCount?: number;
  retryQuestionCount?: number;
  timedOut?: boolean;
  questionDeadlineAt?: string | null;
  error?: string;
};

type AttemptResponse = {
  attempt?: Attempt;
  error?: string;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function SpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path
        d="M5 9v6h4l5 4V5L9 9H5Z"
        fill="currentColor"
      />
      <path
        d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function QuizPlayer({
  initialAttempt,
  initialRemainingSeconds,
}: {
  initialAttempt: Attempt;
  initialRemainingSeconds: number;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(initialAttempt);
  const [remaining, setRemaining] = useState(initialRemainingSeconds);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [correctChoice, setCorrectChoice] = useState<number | null>(null);
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null);
  const [answerTimedOut, setAnswerTimedOut] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [timeWarning, setTimeWarning] = useState("");
  const expireStarted = useRef(false);
  const timeWarningAnnounced = useRef(false);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayedQuestions = useRef(new Set<string>());

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
      ? question.retryIsCorrect !== null
      : question.initialIsCorrect !== null,
  ).length;
  const progress =
    phaseQuestions.length === 0
      ? 100
      : Math.round((completedInPhase / phaseQuestions.length) * 100);
  const priorWrongIndicator = currentQuestion
    ? getPriorWrongIndicator(currentQuestion.priorWrongLevel)
    : null;
  const promptUsesPronunciation =
    currentQuestion?.direction === "english_to_korean";
  const choicesUsePronunciation =
    currentQuestion?.direction === "korean_to_english";
  const choiceAudioEnabled = Boolean(
    currentQuestion &&
      choicesUsePronunciation &&
      allChoiceAudioAvailable(currentQuestion.choicePronunciations),
  );

  const playAudio = useCallback((audioUrl: string | null) => {
    if (!audioUrl) return;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.pause();
    audio.currentTime = 0;
    audio.src = audioUrl;
    void audio.play().catch(() => {
      // Browser autoplay can be blocked. Audio is optional and must never
      // interrupt answer persistence or the server-owned timer.
    });
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !currentQuestion ||
      currentQuestion.direction !== "english_to_korean" ||
      !currentQuestion.pronunciation.available
    ) {
      return;
    }
    const playKey = `${attempt.id}:${attempt.phase}:${currentQuestion.id}`;
    if (autoPlayedQuestions.current.has(playKey)) return;
    autoPlayedQuestions.current.add(playKey);
    playAudio(currentQuestion.pronunciation.audioUrl);
  }, [
    attempt.id,
    attempt.phase,
    currentQuestion,
    playAudio,
  ]);

  const expireAttempt = useCallback(async () => {
    if (expireStarted.current) return;
    expireStarted.current = true;
    try {
      await fetch(`/api/student/attempts/${attempt.id}/expire`, {
        method: "POST",
      });
    } finally {
      router.replace(`/student/result/${attempt.id}`);
    }
  }, [attempt.id, router]);

  const recoverAttempt = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/student/attempts/${attempt.id}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as AttemptResponse;
      if (!response.ok || !payload.attempt) {
        return false;
      }

      if (
        payload.attempt.status !== "in_progress" ||
        payload.attempt.phase === "review" ||
        payload.attempt.phase === "completed"
      ) {
        setSubmitting(false);
        router.replace(`/student/result/${attempt.id}`);
        return true;
      }

      expireStarted.current = false;
      timeWarningAnnounced.current = false;
      setTimeWarning("");
      setAttempt(payload.attempt);
      setRemaining(
        secondsUntil(
          payload.attempt.timerDeadlineAt,
          currentTimeMilliseconds(),
        ) ?? 0,
      );
      setSelectedChoice(null);
      setCorrectChoice(null);
      setAnswerCorrect(null);
      setAnswerTimedOut(false);
      setSubmitting(false);
      return true;
    } catch {
      return false;
    }
  }, [attempt.id, router]);

  useEffect(() => {
    expireStarted.current = false;
    timeWarningAnnounced.current = false;
    const updateRemaining = () => {
      setRemaining(
        secondsUntil(
          attempt.timerDeadlineAt,
          currentTimeMilliseconds(),
        ) ?? 0,
      );
    };
    const timer = window.setInterval(() => {
      updateRemaining();
    }, 500);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") updateRemaining();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [attempt.timerDeadlineAt]);

  useEffect(() => {
    if (
      remaining > 0 &&
      remaining <= 30 &&
      !timeWarningAnnounced.current
    ) {
      timeWarningAnnounced.current = true;
      setTimeWarning(studentAppText.attempt.timeWarning);
    }
  }, [remaining]);

  const submitChoice = useCallback(
    async (choiceIndex: number | null) => {
      if (!currentQuestion || submitting || answerCorrect !== null) return;

      setSubmitting(true);
      setError("");
      setSelectedChoice(choiceIndex);
      let recoveryAttempted = false;
      const tryRecover = async () => {
        if (recoveryAttempted) return false;
        recoveryAttempted = true;
        return recoverAttempt();
      };
      try {
        const response = await fetch(
          `/api/student/attempts/${attempt.id}/${
            choiceIndex === null ? "timeouts" : "answers"
          }`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              questionId: currentQuestion.id,
              phase: attempt.phase,
              ...(choiceIndex === null ? {} : { choiceIndex }),
            }),
          },
        );
        const payload = (await response.json()) as AnswerResponse;
        if (!response.ok) {
          if (await tryRecover()) return;
          throw new Error(payload.error ?? studentAppText.attempt.saveError);
        }
        if (payload.expired) {
          router.replace(`/student/result/${attempt.id}`);
          return;
        }

        setAnswerCorrect(Boolean(payload.correct));
        setAnswerTimedOut(Boolean(payload.timedOut));
        setCorrectChoice(
          typeof payload.correctChoiceIndex === "number"
            ? payload.correctChoiceIndex
            : null,
        );

        const answeredPhase = attempt.phase;
        window.setTimeout(() => {
          if (payload.completed) {
            router.replace(`/student/result/${attempt.id}`);
            return;
          }

          if (payload.needsRetry && answeredPhase === "initial") {
            router.replace(`/student/result/${attempt.id}`);
            return;
          }

          if (!payload.nextQuestionId || !payload.nextPhase) {
            void tryRecover().then((recovered) => {
              if (recovered) return;
              setError(studentAppText.attempt.stateError);
              setSubmitting(false);
            });
            return;
          }

          const nextTimerDeadlineAt =
            payload.questionDeadlineAt ?? attempt.timerDeadlineAt;
          setAttempt((current) => ({
            ...current,
            phase: payload.nextPhase ?? current.phase,
            timerDeadlineAt: nextTimerDeadlineAt,
            currentQuestionId:
              payload.nextQuestionId ?? current.currentQuestionId,
            questions: current.questions.map((question) =>
              question.id === currentQuestion.id
                ? {
                    ...question,
                    initialChoiceIndex:
                      answeredPhase === "initial"
                        ? choiceIndex
                        : question.initialChoiceIndex,
                    initialIsCorrect:
                      answeredPhase === "initial"
                        ? Boolean(payload.correct)
                        : question.initialIsCorrect,
                    initialTimedOut:
                      answeredPhase === "initial"
                        ? Boolean(payload.timedOut)
                        : question.initialTimedOut,
                    retryChoiceIndex:
                      answeredPhase === "retry"
                        ? choiceIndex
                        : question.retryChoiceIndex,
                    retryIsCorrect:
                      answeredPhase === "retry"
                        ? Boolean(payload.correct)
                        : question.retryIsCorrect,
                    retryTimedOut:
                      answeredPhase === "retry"
                        ? Boolean(payload.timedOut)
                        : question.retryTimedOut,
                    revealedCorrectChoiceIndex:
                      typeof payload.correctChoiceIndex === "number"
                        ? payload.correctChoiceIndex
                        : question.revealedCorrectChoiceIndex,
                  }
                : question,
            ),
          }));
          setRemaining(
            secondsUntil(
              nextTimerDeadlineAt,
              currentTimeMilliseconds(),
            ) ?? 0,
          );
          setSelectedChoice(null);
          setCorrectChoice(null);
          setAnswerCorrect(null);
          setAnswerTimedOut(false);
          setSubmitting(false);
          timeWarningAnnounced.current = false;
          setTimeWarning("");
        }, ANSWER_FEEDBACK_DELAY_MS);
      } catch (requestError) {
        if (await tryRecover()) return;
        setSelectedChoice(null);
        setCorrectChoice(null);
        setAnswerCorrect(null);
        setAnswerTimedOut(false);
        setError(
          requestError instanceof Error
            ? requestError.message
            : studentAppText.attempt.saveError,
        );
        setSubmitting(false);
      }
    },
    [
      answerCorrect,
      attempt.id,
      attempt.phase,
      attempt.timerDeadlineAt,
      currentQuestion,
      recoverAttempt,
      router,
      submitting,
    ],
  );

  useEffect(() => {
    if (remaining !== 0 || attempt.status !== "in_progress") return;
    const timer = window.setTimeout(() => {
      if (attempt.timingMode === "per_question") {
        void submitChoice(null);
        return;
      }
      void expireAttempt();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    attempt.status,
    attempt.timingMode,
    expireAttempt,
    remaining,
    submitChoice,
  ]);

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
          {studentAppText.attempt.finalizing}
        </div>
      </section>
    );
  }

  return (
    <section className="quiz-card">
      <div className="quiz-topline">
        <div>
          <p className="quiz-phase">
            {attempt.phase === "retry"
              ? studentAppText.attempt.retryPhase
              : studentAppText.attempt.initialPhase}
          </p>
          <strong>{attempt.assignmentTitle}</strong>
        </div>
        <span
          aria-label={formatContentText(studentAppText.attempt.remaining, {
            prefix:
              attempt.timingMode === "per_question"
                ? studentAppText.attempt.perQuestionPrefix
                : "",
            time: formatTime(remaining),
          })}
          className={`timer ${remaining <= 30 ? "timer-warning" : ""}`}
        >
          {formatTime(remaining)}
        </span>
      </div>

      <div
        aria-label={formatContentText(studentAppText.attempt.progressAria, {
          percent: progress,
        })}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="progress-track"
        role="progressbar"
      >
        <div className="progress-value" style={{ width: `${progress}%` }} />
      </div>

      <p className="quiz-direction">
        <span className="label-with-help">
          {attempt.phase === "retry"
            ? formatContentText(studentAppText.attempt.retryProgress, {
                current: completedInPhase + 1,
                total: phaseQuestions.length,
              })
            : `${currentQuestion.orderIndex}/${attempt.questions.length}`}
          <HelpTip label={studentAppText.attempt.keyboardShortcutAria}>
            {studentAppText.attempt.keyboardShortcutHelp}
          </HelpTip>
        </span>
        <span className="sr-only">
          {currentQuestion.direction === "english_to_korean"
            ? studentAppText.attempt.chooseMeaning
            : studentAppText.attempt.chooseEnglish}
        </span>
      </p>
      {priorWrongIndicator && (
        <div
          className={[
            "quiz-prior-wrong",
            priorWrongIndicator.markerCount === 2
              ? "quiz-prior-wrong-repeated"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          id="quiz-prior-wrong"
        >
          <span aria-hidden="true" className="quiz-prior-wrong-marks">
            {Array.from(
              { length: priorWrongIndicator.markerCount },
              (_, index) => (
                <i key={index}>!</i>
              ),
            )}
          </span>
          <span>{priorWrongIndicator.label}</span>
        </div>
      )}
      <div
        className={[
          "quiz-prompt-row",
          promptUsesPronunciation
            ? "quiz-prompt-row--with-pronunciation"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <h1
          aria-describedby={
            priorWrongIndicator ? "quiz-prior-wrong" : undefined
          }
          className={[
            "quiz-prompt",
            currentQuestion.direction === "korean_to_english"
              ? "quiz-prompt--ko"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          id="quiz-prompt"
          ref={promptRef}
          tabIndex={-1}
        >
          <span>{currentQuestion.prompt}</span>
          {currentQuestion.direction === "english_to_korean" &&
            currentQuestion.pronunciation.displayKo && (
              <small className="quiz-pronunciation">
                {currentQuestion.pronunciation.displayKo}
              </small>
            )}
        </h1>
        {promptUsesPronunciation &&
          currentQuestion.pronunciation.available && (
            <button
              aria-label={formatContentText(
                studentAppText.attempt.pronunciationAria,
                { word: currentQuestion.prompt },
              )}
              className="pronunciation-button pronunciation-button--prompt pronunciation-button--choice"
              onClick={() =>
                playAudio(currentQuestion.pronunciation.audioUrl)
              }
              type="button"
            >
              <SpeakerIcon />
            </button>
          )}
        {promptUsesPronunciation &&
          !currentQuestion.pronunciation.available && (
          <span
            aria-hidden="true"
            className="choice-audio-placeholder pronunciation-button--choice"
          />
        )}
      </div>

      <div
        aria-labelledby="quiz-prompt"
        className="choice-list"
        role="group"
      >
        {currentQuestion.choices.map((choice, index) => {
          const classNames = ["choice"];
          if (currentQuestion.direction === "korean_to_english") {
            classNames.push("choice--en");
          }
          if (Array.from(choice).length >= 54) {
            classNames.push("choice--very-long");
          } else if (Array.from(choice).length >= 30) {
            classNames.push("choice--long");
          }
          if (correctChoice === index) classNames.push("choice-correct");
          if (
            selectedChoice === index &&
            answerCorrect === false &&
            correctChoice !== index
          ) {
            classNames.push("choice-wrong");
          }

          const choicePronunciation =
            currentQuestion.choicePronunciations[index];
          return (
            <div
              className={[
                "choice-row",
                choicesUsePronunciation
                  ? "choice-row--with-pronunciation"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${currentQuestion.id}:${index}`}
            >
              <button
                className={classNames.join(" ")}
                disabled={submitting || answerCorrect !== null}
                onClick={() => {
                  if (choiceAudioEnabled) {
                    playAudio(choicePronunciation?.audioUrl ?? null);
                  }
                  void submitChoice(index);
                }}
                type="button"
              >
                <span className="choice-number">{index + 1}</span>
                <span
                  className={[
                    "choice-copy",
                    choicesUsePronunciation
                      ? ""
                      : "choice-copy--without-pronunciation",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span>{choice}</span>
                  {choicesUsePronunciation ? (
                    <small
                      aria-hidden={!choicePronunciation?.displayKo}
                      className="choice-pronunciation"
                    >
                      {choicePronunciation?.displayKo ?? "\u00a0"}
                    </small>
                  ) : null}
                </span>
              </button>
              {choicesUsePronunciation && choiceAudioEnabled && (
                <button
                  aria-label={formatContentText(
                    studentAppText.attempt.pronunciationAria,
                    { word: choice },
                  )}
                  className="pronunciation-button pronunciation-button--choice"
                  disabled={submitting || answerCorrect !== null}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    playAudio(choicePronunciation?.audioUrl ?? null);
                  }}
                  type="button"
                >
                  <SpeakerIcon />
                </button>
              )}
              {choicesUsePronunciation && !choiceAudioEnabled && (
                <span
                  aria-hidden="true"
                  className="choice-audio-placeholder pronunciation-button--choice"
                />
              )}
            </div>
          );
        })}
      </div>

      {answerCorrect === false ? (
        <div
          aria-atomic="true"
          aria-live="assertive"
          className="feedback feedback-wrong"
          role="alert"
        >
          {answerTimedOut
            ? studentAppText.attempt.timedOut
            : attempt.phase === "initial"
              ? studentAppText.attempt.wrongInitial
              : studentAppText.attempt.wrongRetry}
        </div>
      ) : null}
      <span aria-live="assertive" className="sr-only" role="status">
        {answerCorrect === true ? studentAppText.attempt.correct : ""}
      </span>
      {error && (
        <div className="inline-error quiz-error" role="alert">
          {error}
        </div>
      )}
      <span aria-live="assertive" className="sr-only" role="status">
        {timeWarning}
      </span>
    </section>
  );
}
