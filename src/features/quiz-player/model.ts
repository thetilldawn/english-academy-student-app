import type { QuizDirection } from "@/lib/quiz/question-types";
import type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";

export type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";

export type QuizAttemptPhase =
  | "initial"
  | "review"
  | "retry"
  | "completed";

export type QuizQuestion = {
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

export type QuizAttempt = {
  id: string;
  assignmentTitle: string;
  status: "in_progress" | "completed" | "expired";
  phase: QuizAttemptPhase;
  startedAt: string;
  deadlineAt: string;
  timerDeadlineAt: string;
  timingMode: "none" | "total" | "per_question";
  questionTimeLimitSeconds: number | null;
  questions: QuizQuestion[];
  currentQuestionId: string | null;
};

export type QuizAnswerResponse = {
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
  timerRemainingMilliseconds?: number | null;
  feedbackProtocol?: "legacy" | "variable";
  error?: string;
};

export type QuizFeedbackResumeResponse = {
  questionDeadlineAt: string;
  questionStartsAt: string;
  timerRemainingMilliseconds: number;
  transitionRemainingMilliseconds: number;
};

export type QuizAttemptResponse = {
  attempt: QuizAttempt;
  timerRemainingMilliseconds: number;
};

export type QuizTransportResult<T> =
  | {
      ok: true;
      payload: T;
      receivedAt: number;
      roundTripMilliseconds: number;
    }
  | {
      ok: false;
      payload: { error?: string };
      receivedAt: number;
      roundTripMilliseconds: number;
    };
