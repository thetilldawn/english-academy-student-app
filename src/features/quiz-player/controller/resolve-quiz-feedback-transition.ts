import { resumeQuizAfterFeedback } from "../api/quiz-attempt";
import {
  ANSWER_AUDIO_END_GRACE_MS,
  ANSWER_FEEDBACK_DELAY_MS,
  ANSWER_RESULT_VISIBLE_MS,
  type QuizAnswerDisposition,
} from "../domain/quiz-session";
import type {
  QuizAnswerResponse,
  QuizFeedbackResumeResponse,
} from "../model";
import type { QuizAudioCompletion } from "./quiz-audio-element";

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

function fixedFeedbackRemaining(input: {
  receivedAt: number;
  submittedAt: number;
  timedOut: boolean;
}) {
  const now = performance.now();
  const totalRemaining = Math.max(
    0,
    ANSWER_FEEDBACK_DELAY_MS - (now - input.submittedAt),
  );
  const resultVisibleRemaining = input.timedOut
    ? 0
    : Math.max(0, ANSWER_RESULT_VISIBLE_MS - (now - input.receivedAt));
  return Math.max(totalRemaining, resultVisibleRemaining);
}

async function synchronizeNextQuestion(input: {
  attemptId: string;
  delayMilliseconds: number;
  nextPhase: "initial" | "retry";
  nextQuestionId: string;
  payload: QuizAnswerResponse;
  receivedAt: number;
}): Promise<QuizFeedbackSynchronization> {
  for (let request = 0; request < 2; request += 1) {
    try {
      const resumed = await resumeQuizAfterFeedback({
        attemptId: input.attemptId,
        nextPhase: input.nextPhase,
        nextQuestionId: input.nextQuestionId,
        transitionRemainingMilliseconds: Math.ceil(
          input.delayMilliseconds,
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
  answerAudioUrl: string | null;
  attemptId: string;
  disposition: QuizAnswerDisposition;
  isActive: () => boolean;
  payload: QuizAnswerResponse;
  playAnswerAudio: (audioUrl: string) => Promise<QuizAudioCompletion>;
  receivedAt: number;
  submittedAt: number;
}): Promise<ResolvedQuizFeedbackTransition> {
  let delayMilliseconds: number;
  if (
    input.payload.correct === true &&
    input.payload.timedOut !== true &&
    input.answerAudioUrl
  ) {
    const playback = await input.playAnswerAudio(input.answerAudioUrl);
    delayMilliseconds =
      playback === "ended"
        ? ANSWER_AUDIO_END_GRACE_MS
        : fixedFeedbackRemaining({
            receivedAt: input.receivedAt,
            submittedAt: input.submittedAt,
            timedOut: Boolean(input.payload.timedOut),
          });
  } else {
    delayMilliseconds = fixedFeedbackRemaining({
      receivedAt: input.receivedAt,
      submittedAt: input.submittedAt,
      timedOut: Boolean(input.payload.timedOut),
    });
  }
  if (!input.isActive()) {
    return { synchronization: null };
  }

  const synchronization =
    input.disposition === "next-question" &&
    input.payload.nextQuestionId &&
    input.payload.nextPhase
      ? synchronizeNextQuestion({
          attemptId: input.attemptId,
          delayMilliseconds,
          nextPhase: input.payload.nextPhase,
          nextQuestionId: input.payload.nextQuestionId,
          payload: input.payload,
          receivedAt: input.receivedAt,
        })
      : null;
  await wait(delayMilliseconds);
  return { synchronization };
}
