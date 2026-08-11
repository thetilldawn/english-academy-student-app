import { describe, expect, it } from "vitest";

import { unavailablePronunciation } from "@/lib/quiz/pronunciation-snapshot";

import type { QuizAttempt, QuizQuestion } from "../model";
import {
  ANSWER_FEEDBACK_DELAY_MS,
  applyQuizAnswerTransition,
  quizAnswerDisposition,
  quizAudioPresentation,
  quizChoicesDensity,
  quizPromptDensity,
} from "./quiz-session";

const availablePronunciation = {
  audioUrl: "https://example.com/audio.mp3",
  available: true,
  displayKo: "테스트",
  variantId: "test:1",
} as const;

function question(
  direction: QuizQuestion["direction"],
): QuizQuestion {
  return {
    choicePronunciations: Array.from(
      { length: 4 },
      () => availablePronunciation,
    ),
    choices: ["one", "two", "three", "four"],
    direction,
    id: "question-1",
    initialChoiceIndex: null,
    initialIsCorrect: null,
    initialTimedOut: false,
    orderIndex: 1,
    priorWrongLevel: 0,
    prompt: "test",
    pronunciation: availablePronunciation,
    retryChoiceIndex: null,
    retryIsCorrect: null,
    retryTimedOut: false,
    revealedCorrectChoiceIndex: null,
  };
}

function attempt(): QuizAttempt {
  return {
    assignmentTitle: "Quiz",
    currentQuestionId: "question-1",
    deadlineAt: "2099-01-01T00:10:00.000Z",
    id: "attempt-1",
    phase: "initial",
    questionTimeLimitSeconds: 10,
    questions: [question("english_to_korean")],
    startedAt: "2099-01-01T00:00:00.000Z",
    status: "in_progress",
    timerDeadlineAt: "2099-01-01T00:00:10.000Z",
    timingMode: "per_question",
  };
}

describe("quiz session domain", () => {
  it("enables audio only on the English side of each direction", () => {
    const englishPrompt = quizAudioPresentation(
      question("english_to_korean"),
    );
    expect(englishPrompt).toEqual({
      choiceAudioEnabled: false,
      promptAudioUrl: availablePronunciation.audioUrl,
    });

    const englishChoices = quizAudioPresentation(
      question("korean_to_english"),
    );
    expect(englishChoices).toEqual({
      choiceAudioEnabled: true,
      promptAudioUrl: null,
    });

    const missingChoice = question("korean_to_english");
    missingChoice.choicePronunciations[3] = unavailablePronunciation();
    expect(quizAudioPresentation(missingChoice)).toEqual({
      choiceAudioEnabled: false,
      promptAudioUrl: null,
    });
  });

  it("uses one density derived from the longest of all four choices", () => {
    expect(
      quizChoicesDensity([
        "short",
        "another short choice",
        "x".repeat(55),
        "last",
      ]),
    ).toBe("very-long");
    expect(
      quizPromptDensity("pneumonoultramicroscopics", "english_to_korean"),
    ).toBe("very-long");
  });

  it("requires the server timer before advancing locally", () => {
    expect(
      quizAnswerDisposition(
        {
          correct: true,
          correctChoiceIndex: 0,
          nextPhase: "initial",
          nextQuestionId: "question-2",
        },
        "initial",
      ),
    ).toBe("recover");
    expect(
      quizAnswerDisposition(
        {
          correct: true,
          correctChoiceIndex: 0,
          nextPhase: "initial",
          nextQuestionId: "question-2",
          questionDeadlineAt: "2099-01-01T00:00:10.000Z",
          timerRemainingMilliseconds: 10_000,
        },
        "initial",
      ),
    ).toBe("next-question");
    expect(ANSWER_FEEDBACK_DELAY_MS).toBe(500);
  });

  it("applies the answer and next server state without rebuilding questions", () => {
    const before = attempt();
    const after = applyQuizAnswerTransition({
      answeredPhase: "initial",
      answeredQuestionId: "question-1",
      attempt: before,
      choiceIndex: 2,
      payload: {
        correct: false,
        correctChoiceIndex: 1,
        nextPhase: "retry",
        nextQuestionId: "question-1",
      },
      timerDeadlineAt: "2099-01-01T00:00:20.000Z",
    });

    expect(after).toMatchObject({
      currentQuestionId: "question-1",
      phase: "retry",
      timerDeadlineAt: "2099-01-01T00:00:20.000Z",
    });
    expect(after.questions[0]).toMatchObject({
      initialChoiceIndex: 2,
      initialIsCorrect: false,
      revealedCorrectChoiceIndex: 1,
    });
    expect(before.questions[0].initialChoiceIndex).toBeNull();
  });
});
