import { resumeQuizAfterFeedback } from "../api/quiz-attempt";
import {
  ANSWER_AUDIO_END_GRACE_MS,
  ANSWER_FEEDBACK_DELAY_MS,
  type QuizAnswerDisposition,
} from "../domain/quiz-session";
import type { QuizAnswerResponse } from "../model";
import type { QuizAudioCompletion } from "./quiz-audio-element";

export type ResolvedQuizFeedbackTransition = {
  delayMilliseconds: number;
  payload: QuizAnswerResponse;
  receivedAt: number;
  recoverFromServer?: boolean;
};

function fallbackTransition(
  payload: QuizAnswerResponse,
  receivedAt: number,
): ResolvedQuizFeedbackTransition {
  return {
    delayMilliseconds: Math.max(
      0,
      ANSWER_FEEDBACK_DELAY_MS - (performance.now() - receivedAt),
    ),
    payload,
    receivedAt,
  };
}

export async function resolveQuizFeedbackTransition(input: {
  answerAudioUrl: string | null;
  attemptId: string;
  disposition: QuizAnswerDisposition;
  payload: QuizAnswerResponse;
  playAnswerAudio: (audioUrl: string) => Promise<QuizAudioCompletion>;
  receivedAt: number;
}): Promise<ResolvedQuizFeedbackTransition> {
  const fallback = () => fallbackTransition(input.payload, input.receivedAt);
  if (
    input.payload.correct !== true ||
    input.payload.timedOut === true ||
    !input.answerAudioUrl
  ) {
    return fallback();
  }

  const playback = await input.playAnswerAudio(input.answerAudioUrl);
  if (playback !== "ended") return fallback();
  const playbackCompletedAt = performance.now();
  if (input.disposition === "result") {
    return {
      delayMilliseconds: ANSWER_AUDIO_END_GRACE_MS,
      payload: input.payload,
      receivedAt: performance.now(),
    };
  }
  if (
    input.disposition !== "next-question" ||
    !input.payload.nextQuestionId ||
    !input.payload.nextPhase
  ) {
    return fallback();
  }

  const resumeInput = {
    attemptId: input.attemptId,
    nextPhase: input.payload.nextPhase,
    nextQuestionId: input.payload.nextQuestionId,
  };
  for (let request = 0; request < 2; request += 1) {
    try {
      const resumed = await resumeQuizAfterFeedback(resumeInput);
      if (!resumed.ok) continue;
      const localGraceRemaining = Math.max(
        0,
        ANSWER_AUDIO_END_GRACE_MS -
          (performance.now() - playbackCompletedAt),
      );
      const serverStartEstimate = Math.max(
        0,
        resumed.payload.transitionRemainingMilliseconds -
          resumed.roundTripMilliseconds / 2,
      );
      return {
        delayMilliseconds: Math.max(
          localGraceRemaining,
          serverStartEstimate,
        ),
        payload: {
          ...input.payload,
          questionDeadlineAt: resumed.payload.questionDeadlineAt,
          timerRemainingMilliseconds:
            resumed.payload.timerRemainingMilliseconds,
        },
        receivedAt: resumed.receivedAt,
      };
    } catch {
      // A committed response can still be lost. Retry the idempotent RPC.
    }
  }
  return { ...fallback(), recoverFromServer: true };
}
