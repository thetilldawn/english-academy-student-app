import { studentAppText } from "@/content/ko/student-app";
import type {
  QuizAnswerResponse,
  QuizAttempt,
  QuizAttemptPhase,
  QuizQuestion,
} from "../model";

export const ANSWER_FEEDBACK_DELAY_MS = 750;

export function currentQuizQuestion(attempt: QuizAttempt) {
  return (
    attempt.questions.find(
      (question) => question.id === attempt.currentQuestionId,
    ) ?? null
  );
}

export function quizPhaseQuestions(attempt: QuizAttempt) {
  return attempt.phase === "retry"
    ? attempt.questions.filter(
        (question) => question.initialIsCorrect === false,
      )
    : attempt.questions;
}

export function completedQuizQuestions(attempt: QuizAttempt) {
  return quizPhaseQuestions(attempt).filter((question) =>
    attempt.phase === "retry"
      ? question.retryIsCorrect !== null
      : question.initialIsCorrect !== null,
  ).length;
}

export function quizProgress(attempt: QuizAttempt) {
  const questions = quizPhaseQuestions(attempt);
  return questions.length === 0
    ? 100
    : Math.round((completedQuizQuestions(attempt) / questions.length) * 100);
}

export type QuizAudioPresentation = {
  promptAudioUrl: string | null;
  choiceAudioEnabled: boolean;
};

export function quizAudioPresentation(
  question: QuizQuestion,
): QuizAudioPresentation {
  const promptAudioUrl =
    question.direction === "english_to_korean" &&
    question.pronunciation.available
      ? question.pronunciation.audioUrl
      : null;
  const choiceAudioEnabled =
    question.direction === "korean_to_english" &&
    question.choicePronunciations.some(
      (pronunciation) => pronunciation.available,
    );

  return { promptAudioUrl, choiceAudioEnabled };
}

export function quizChoiceAudioUrls(question: QuizQuestion) {
  return question.direction === "korean_to_english"
    ? question.choicePronunciations.flatMap((pronunciation) =>
        pronunciation.available && pronunciation.audioUrl
          ? [pronunciation.audioUrl]
          : [],
      )
    : [];
}

export function quizAnswerAudioUrl(
  question: QuizQuestion,
  choiceIndex: number | null,
) {
  if (choiceIndex === null) return null;
  const pronunciation =
    question.direction === "korean_to_english"
      ? question.choicePronunciations[choiceIndex]
      : question.pronunciation;
  return pronunciation?.available ? pronunciation.audioUrl : null;
}

export function quizPreloadAudioUrls(attempt: QuizAttempt) {
  const current = currentQuizQuestion(attempt);
  if (!current) return [];
  const urls = quizChoiceAudioUrls(current);
  const phaseQuestions = quizPhaseQuestions(attempt);
  const currentIndex = phaseQuestions.findIndex(
    (question) => question.id === current.id,
  );
  const nextQuestion = phaseQuestions[currentIndex + 1];
  const nextPromptUrl = nextQuestion
    ? quizAudioPresentation(nextQuestion).promptAudioUrl
    : null;
  return nextPromptUrl ? [...new Set([...urls, nextPromptUrl])] : urls;
}

export type QuizChoiceLength = "default" | "long" | "very-long";

export function quizChoiceLength(choice: string): QuizChoiceLength {
  const length = Array.from(choice).length;
  if (length >= 54) return "very-long";
  if (length >= 30) return "long";
  return "default";
}

export function quizChoicesDensity(
  choices: readonly string[],
): QuizChoiceLength {
  const ranks: Record<QuizChoiceLength, number> = {
    default: 0,
    long: 1,
    "very-long": 2,
  };
  return choices.reduce<QuizChoiceLength>((density, choice) => {
    const candidate = quizChoiceLength(choice);
    return ranks[candidate] > ranks[density] ? candidate : density;
  }, "default");
}

export function quizPromptDensity(
  prompt: string,
  direction: QuizQuestion["direction"],
): QuizChoiceLength {
  const length = Array.from(prompt).length;
  if (direction === "english_to_korean") {
    if (length >= 24) return "very-long";
    if (length >= 15) return "long";
    return "default";
  }
  return quizChoiceLength(prompt);
}

export function quizAnswerAnnouncement(
  phase: QuizAttemptPhase,
  correct: boolean | null,
  timedOut: boolean,
) {
  if (correct === null) return "";
  if (correct) return studentAppText.attempt.correct;
  if (timedOut) return studentAppText.attempt.timedOut;
  return phase === "initial"
    ? studentAppText.attempt.wrongInitial
    : studentAppText.attempt.wrongRetry;
}

export type QuizAnswerDisposition =
  | "result"
  | "next-question"
  | "recover";

export function quizAnswerDisposition(
  payload: QuizAnswerResponse,
  answeredPhase: QuizAttemptPhase,
): QuizAnswerDisposition {
  if (payload.completed) return "result";
  if (payload.needsRetry && answeredPhase === "initial") return "result";
  if (
    !payload.nextQuestionId ||
    !payload.nextPhase ||
    !payload.questionDeadlineAt ||
    typeof payload.timerRemainingMilliseconds !== "number" ||
    !Number.isFinite(payload.timerRemainingMilliseconds) ||
    payload.timerRemainingMilliseconds < 0
  ) {
    return "recover";
  }
  return "next-question";
}

export function applyQuizAnswerTransition(input: {
  attempt: QuizAttempt;
  answeredQuestionId: string;
  answeredPhase: QuizAttemptPhase;
  choiceIndex: number | null;
  payload: QuizAnswerResponse;
  timerDeadlineAt: string;
}) {
  const {
    attempt,
    answeredQuestionId,
    answeredPhase,
    choiceIndex,
    payload,
    timerDeadlineAt,
  } = input;

  return {
    ...attempt,
    phase: payload.nextPhase ?? attempt.phase,
    timerDeadlineAt,
    currentQuestionId: payload.nextQuestionId ?? attempt.currentQuestionId,
    questions: attempt.questions.map((question) =>
      question.id === answeredQuestionId
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
  } satisfies QuizAttempt;
}
