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
  pendingChoice: number | null;
  selectionVersion: number;
  submitting: boolean;
  error: string;
  timerSynchronized: boolean;
  transitionPending: boolean;
  timeWarning: string;
};

export type QuizPlayerAction =
  | { type: "timer-ticked"; remainingSeconds: number }
  | { type: "time-warning"; message: string }
  | { type: "synchronization-started" }
  | { type: "choice-pending"; choiceIndex: number | null }
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
      preservePendingChoice?: boolean;
    }
  | { type: "feedback-transitioned"; attempt: QuizAttempt }
  | { type: "submission-failed"; message: string };

export function createQuizPlayerState(
  attempt: QuizAttempt,
  remainingSeconds: number,
): QuizPlayerState {
  return {
    attempt,
    remainingSeconds,
    feedback: null,
    pendingChoice: null,
    selectionVersion: 0,
    submitting: false,
    error: "",
    timerSynchronized: false,
    transitionPending: false,
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
        pendingChoice: null,
        selectionVersion: state.selectionVersion + 1,
        feedback: null,
        submitting: false,
        error: "",
        timerSynchronized: false,
        transitionPending: false,
        timeWarning: "",
      };
    case "choice-pending":
      return { ...state, pendingChoice: action.choiceIndex };
    case "submission-started":
      return {
        ...state,
        pendingChoice: null,
        feedback: {
          phase: action.phase,
          selectedChoice: action.choiceIndex,
          correctChoice: null,
          correct: null,
          timedOut: action.choiceIndex === null,
        },
        submitting: true,
        error: "",
        transitionPending: false,
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
        pendingChoice: action.preservePendingChoice ? state.pendingChoice : null,
        selectionVersion: state.selectionVersion + (action.preservePendingChoice ? 0 : 1),
        attempt: action.attempt,
        remainingSeconds: action.remainingSeconds,
        feedback: null,
        submitting: false,
        error: "",
        timerSynchronized: true,
        transitionPending: false,
        timeWarning: "",
      };
    case "feedback-transitioned":
      return {
        ...state,
        pendingChoice: null,
        attempt: action.attempt,
        feedback: null,
        submitting: false,
        error: "",
        timerSynchronized: true,
        transitionPending: true,
        timeWarning: "",
      };
    case "submission-failed":
      return {
        ...state,
        pendingChoice: null,
        selectionVersion: state.selectionVersion + 1,
        feedback: null,
        submitting: false,
        error: action.message,
        transitionPending: false,
      };
  }
}
