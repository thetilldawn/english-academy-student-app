import type {
  QuizAnswerResponse,
  QuizAttempt,
  QuizAttemptPhase,
} from "../model";

export type QuizFeedback = {
  phase: QuizAttemptPhase;
  selectedChoice: number | null;
  correctChoice: number | null;
  correct: boolean | null;
  timedOut: boolean;
};

export type QuizPlayerState = {
  attempt: QuizAttempt;
  remainingSeconds: number;
  feedback: QuizFeedback | null;
  submitting: boolean;
  error: string;
  timerSynchronized: boolean;
  timeWarning: string;
};

export type QuizPlayerAction =
  | { type: "timer-ticked"; remainingSeconds: number }
  | { type: "time-warning"; message: string }
  | { type: "synchronization-started" }
  | {
      type: "submission-started";
      phase: QuizAttemptPhase;
      choiceIndex: number | null;
    }
  | { type: "answer-received"; payload: QuizAnswerResponse }
  | {
      type: "attempt-replaced";
      attempt: QuizAttempt;
      remainingSeconds: number;
    }
  | { type: "submission-failed"; message: string };

export function createQuizPlayerState(
  attempt: QuizAttempt,
  remainingSeconds: number,
): QuizPlayerState {
  return {
    attempt,
    remainingSeconds,
    feedback: null,
    submitting: false,
    error: "",
    timerSynchronized: false,
    timeWarning: "",
  };
}

export function quizPlayerReducer(
  state: QuizPlayerState,
  action: QuizPlayerAction,
): QuizPlayerState {
  switch (action.type) {
    case "timer-ticked":
      return action.remainingSeconds === state.remainingSeconds
        ? state
        : { ...state, remainingSeconds: action.remainingSeconds };
    case "time-warning":
      return state.timeWarning === action.message
        ? state
        : { ...state, timeWarning: action.message };
    case "synchronization-started":
      return {
        ...state,
        feedback: null,
        submitting: false,
        error: "",
        timerSynchronized: false,
        timeWarning: "",
      };
    case "submission-started":
      return {
        ...state,
        feedback: {
          phase: action.phase,
          selectedChoice: action.choiceIndex,
          correctChoice: null,
          correct: null,
          timedOut: false,
        },
        submitting: true,
        error: "",
      };
    case "answer-received":
      return state.feedback
        ? {
            ...state,
            feedback: {
              ...state.feedback,
              correctChoice:
                typeof action.payload.correctChoiceIndex === "number"
                  ? action.payload.correctChoiceIndex
                  : null,
              correct: Boolean(action.payload.correct),
              timedOut: Boolean(action.payload.timedOut),
            },
          }
        : state;
    case "attempt-replaced":
      return {
        ...state,
        attempt: action.attempt,
        remainingSeconds: action.remainingSeconds,
        feedback: null,
        submitting: false,
        error: "",
        timerSynchronized: true,
        timeWarning: "",
      };
    case "submission-failed":
      return {
        ...state,
        feedback: null,
        submitting: false,
        error: action.message,
      };
  }
}
