import { resumeQuizAfterFeedback } from "../api/quiz-attempt";
import {
  ANSWER_RESULT_VISIBLE_MS,
  type QuizAnswerDisposition,
} from "../domain/quiz-session";
import type {
  QuizAnswerResponse,
  QuizFeedbackResumeResponse,
} from "../model";

export type QuizFeedbackSynchronization = {
  payload: QuizAnswerResponse &
    Pick<
      QuizFeedbackResumeResponse,
      "questionStartsAt" | "transitionRemainingMilliseconds"
    >;
  receivedAt: number;
  recoverFromServer?: boolean;
};

export type ResolvedQuizFeedbackTransition = {
  synchronization: Promise<QuizFeedbackSynchronization> | null;
  ready: QuizFeedbackSynchronization | null;
  quietReservation: boolean;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function synchronizeNextQuestion(input: {
  resume?: typeof resumeQuizAfterFeedback;
  attemptId: string;
  readyAt: number;
  isActive: () => boolean;
  nextPhase: "initial" | "retry";
  nextQuestionId: string;
  payload: QuizAnswerResponse;
  receivedAt: number;
}): Promise<QuizFeedbackSynchronization> {
  for (let request = 0; request < 2; request += 1) {
    if (!input.isActive()) break;
    try {
      const resumed = await (input.resume ?? resumeQuizAfterFeedback)({
        attemptId: input.attemptId,
        nextPhase: input.nextPhase,
        nextQuestionId: input.nextQuestionId,
        transitionRemainingMilliseconds: Math.ceil(
          Math.max(0, input.readyAt - performance.now()),
        ),
      });
      if (!resumed.ok) continue;
      return {
        payload: {
          ...input.payload,
          questionDeadlineAt: resumed.payload.questionDeadlineAt,
          questionStartsAt: resumed.payload.questionStartsAt,
          timerRemainingMilliseconds:
            resumed.payload.timerRemainingMilliseconds,
          transitionRemainingMilliseconds:
            resumed.payload.transitionRemainingMilliseconds,
        },
        receivedAt: resumed.receivedAt,
      };
    } catch {
      // A committed response can still be lost. Retry the idempotent RPC.
    }
  }
  return {
    payload: {
      ...input.payload,
      questionStartsAt: "",
      transitionRemainingMilliseconds: 0,
    },
    receivedAt: input.receivedAt,
    recoverFromServer: true,
  };
}

export async function resolveQuizFeedbackTransition(input: {
  resume?: typeof resumeQuizAfterFeedback;
  attemptId: string;
  disposition: QuizAnswerDisposition;
  isActive: () => boolean;
  payload: QuizAnswerResponse;
  receivedAt: number;
  questionTimeLimitSeconds?: number | null;
}): Promise<ResolvedQuizFeedbackTransition> {
  // Start with the acknowledged result, not the click or an audio event.
  const readyAt = performance.now() + ANSWER_RESULT_VISIBLE_MS;
  if (!input.isActive()) {
    return { synchronization: null, ready: null, quietReservation: false };
  }

  const response: Promise<QuizFeedbackSynchronization> | null =
    input.disposition === "next-question" &&
    input.payload.nextQuestionId &&
    input.payload.nextPhase
      ? input.payload.feedbackProtocol === "legacy"
        ? Promise.resolve({
            payload: {
              ...input.payload,
              questionStartsAt: "",
              // Older servers reserve up to 750ms before a timed question.
              // Do not expose an answerable question before that reservation ends.
              transitionRemainingMilliseconds: input.questionTimeLimitSeconds
                ? Math.max(0, Math.min(750,
                    (input.payload.timerRemainingMilliseconds ?? 0) -
                    input.questionTimeLimitSeconds * 1_000))
                : 0,
            },
            receivedAt: input.receivedAt,
          })
        : synchronizeNextQuestion({
            resume: input.resume,
            attemptId: input.attemptId,
            readyAt,
            isActive: input.isActive,
            nextPhase: input.payload.nextPhase,
            nextQuestionId: input.payload.nextQuestionId,
            payload: input.payload,
            receivedAt: input.receivedAt,
          })
      : null;
  const observed: { value: QuizFeedbackSynchronization | null } = { value: null };
  const synchronization = response?.then(async (result) => {
    observed.value = result;
    const remaining = Math.max(0,
      result.payload.transitionRemainingMilliseconds -
        (performance.now() - result.receivedAt));
    if (!result.recoverFromServer && remaining > 0) await wait(remaining);
    return result;
  }) ?? null;
  await wait(Math.max(0, readyAt - performance.now()));
  const value = observed.value;
  // Equal-deadline timers may fire in either order. Read the confirmed deadline,
  // not whether the promise's timeout callback happened to run first.
  const ready = value && !value.recoverFromServer && input.isActive() &&
    value.payload.transitionRemainingMilliseconds <= performance.now() - value.receivedAt
    ? value : null;
  // A prompt response can still have a few milliseconds of the server's
  // confirmed start reservation left. Keep feedback/input lock during that
  // reservation, without flashing a loader or starting the clock early.
  const reservationLeft = value ? value.payload.transitionRemainingMilliseconds -
    (performance.now() - value.receivedAt) : Infinity;
  const quietReservation = Boolean(value && !value.recoverFromServer &&
    input.payload.feedbackProtocol !== "legacy" && reservationLeft > 0 &&
    reservationLeft <= ANSWER_RESULT_VISIBLE_MS);
  return { synchronization, ready, quietReservation };
}
