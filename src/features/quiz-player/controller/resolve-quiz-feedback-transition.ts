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
    return { synchronization: null };
  }

  const synchronization =
    input.disposition === "next-question" &&
    input.payload.nextQuestionId &&
    input.payload.nextPhase
      ? input.payload.feedbackProtocol === "legacy"
        ? Promise.resolve({
            payload: {
              ...input.payload,
              questionStartsAt: "",
              // Older servers reserve up to 750ms before a timed question.
              // Show it after 200ms, but keep queued input until it can start.
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
  await wait(Math.max(0, readyAt - performance.now()));
  return { synchronization };
}
