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
import type {
  QuizAudioCompletion,
  TimedQuizAudioCompletion,
} from "./quiz-audio-element";

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

function fixedFeedbackReadyAt(input: {
  receivedAt: number;
  submittedAt: number;
  timedOut: boolean;
}) {
  const totalReadyAt = input.submittedAt + ANSWER_FEEDBACK_DELAY_MS;
  const resultVisibleReadyAt = input.timedOut
    ? input.receivedAt
    : input.receivedAt + ANSWER_RESULT_VISIBLE_MS;
  return Math.max(totalReadyAt, resultVisibleReadyAt);
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
  promptAudioCompletion: Promise<TimedQuizAudioCompletion> | null;
  receivedAt: number;
  submittedAt: number;
}): Promise<ResolvedQuizFeedbackTransition> {
  const fixedReadyAt = fixedFeedbackReadyAt({
    receivedAt: input.receivedAt,
    submittedAt: input.submittedAt,
    timedOut: Boolean(input.payload.timedOut),
  });
  let readyAt = fixedReadyAt;
  if (input.payload.feedbackProtocol === "legacy") {
    readyAt = fixedReadyAt;
  } else if (
    input.payload.correct === true &&
    input.payload.timedOut !== true &&
    input.answerAudioUrl
  ) {
    const playback = await input.playAnswerAudio(input.answerAudioUrl);
    if (playback === "ended") {
      // Keep the established answer-audio contract: once the selected English
      // answer finishes, move on after the short grace instead of forcing the
      // silent 750 ms fallback as well.
      readyAt = performance.now() + ANSWER_AUDIO_END_GRACE_MS;
    }
  } else if (
    input.payload.timedOut !== true &&
    input.promptAudioCompletion
  ) {
    const playback = await input.promptAudioCompletion;
    if (playback.outcome === "ended") {
      readyAt = Math.max(
        fixedReadyAt,
        playback.completedAt + ANSWER_AUDIO_END_GRACE_MS,
      );
    }
  }
  const delayMilliseconds = Math.max(
    0,
    readyAt - performance.now(),
  );
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
              transitionRemainingMilliseconds: 0,
            },
            receivedAt: input.receivedAt,
          })
        : synchronizeNextQuestion({
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
