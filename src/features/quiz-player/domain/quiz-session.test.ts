import { describe, expect, it } from "vitest";

import { unavailablePronunciation } from "@/lib/quiz/pronunciation-snapshot";

import type { QuizAttempt, QuizQuestion } from "../model";
import {
  ANSWER_AUDIO_END_GRACE_MS,
  ANSWER_AUDIO_END_TIMEOUT_MS,
  ANSWER_AUDIO_START_TIMEOUT_MS,
  ANSWER_FEEDBACK_DELAY_MS,
  ANSWER_RESULT_VISIBLE_MS,
  ANSWER_SERVER_FEEDBACK_RESERVATION_MS,
  QUIZ_REQUEST_TIMEOUT_MS,
  PROMPT_AUDIO_AUTOPLAY_DELAY_MS,
  applyQuizAnswerTransition,
  quizAnswerAudioUrl,
  quizAnswerDisposition,
  quizAttemptUsesDeadlineClock,
  quizAudioPresentation,
  quizChoiceAudioUrls,
  quizChoicesDensity,
  quizPreloadAudioUrls,
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
    quizContentMode: "book_meaning_choice",
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
  it("uses a hidden deadline clock only when an untimed assignment has a deadline", () => {
    expect(
      quizAttemptUsesDeadlineClock({
        timingMode: "none",
        timerDeadlineAt: "infinity",
      }),
    ).toBe(false);
    expect(
      quizAttemptUsesDeadlineClock({
        timingMode: "none",
        timerDeadlineAt: "2099-01-01T00:10:00.000Z",
      }),
    ).toBe(true);
    expect(
      quizAttemptUsesDeadlineClock({
        timingMode: "total",
        timerDeadlineAt: "2099-01-01T00:10:00.000Z",
      }),
    ).toBe(true);
    expect(
      quizAttemptUsesDeadlineClock({
        timingMode: "none",
        timerDeadlineAt: "invalid-deadline",
      }),
    ).toBe(true);
  });

  it("enables audio only on the English side of each direction", () => {
    const englishPromptQuestion = question("english_to_korean");
    const englishPrompt = quizAudioPresentation(englishPromptQuestion);
    expect(englishPrompt).toEqual({
      choiceAudioEnabled: false,
      promptAudioUrl: availablePronunciation.audioUrl,
    });

    const englishChoiceQuestion = question("korean_to_english");
    const englishChoices = quizAudioPresentation(englishChoiceQuestion);
    expect(englishChoices).toEqual({
      choiceAudioEnabled: true,
      promptAudioUrl: null,
    });

    const missingChoice = question("korean_to_english");
    missingChoice.choicePronunciations[3] = unavailablePronunciation();
    expect(quizAudioPresentation(missingChoice)).toEqual({
      choiceAudioEnabled: true,
      promptAudioUrl: null,
    });
    expect(quizChoiceAudioUrls(missingChoice)).toEqual(
      missingChoice.choicePronunciations
        .filter((pronunciation) => pronunciation.available)
        .map((pronunciation) => pronunciation.audioUrl),
    );
    missingChoice.choicePronunciations = Array.from(
      { length: 4 },
      () => unavailablePronunciation(),
    );
    expect(quizAudioPresentation(missingChoice)).toEqual({
      choiceAudioEnabled: false,
      promptAudioUrl: null,
    });
    expect(quizChoiceAudioUrls(englishChoiceQuestion)).toEqual(
      englishChoiceQuestion.choicePronunciations.map(
        (pronunciation) => pronunciation.audioUrl,
      ),
    );
    expect(quizChoiceAudioUrls(englishPromptQuestion)).toEqual([]);

    expect(quizAnswerAudioUrl(englishPromptQuestion, 2)).toBeNull();
    expect(quizAnswerAudioUrl(englishChoiceQuestion, 2)).toBe(
      englishChoiceQuestion.choicePronunciations[2].audioUrl,
    );
    expect(quizAnswerAudioUrl(englishChoiceQuestion, null)).toBeNull();
    missingChoice.choicePronunciations[2] = unavailablePronunciation();
    expect(quizAnswerAudioUrl(missingChoice, 2)).toBeNull();
  });

  it("preloads the current English choices and the next English prompt", () => {
    const quizAttempt = attempt();
    const current = question("korean_to_english");
    const next = question("english_to_korean");
    current.id = "question-1";
    current.choicePronunciations = current.choicePronunciations.map(
      (pronunciation, index) => ({
        ...pronunciation,
        audioUrl: `https://example.com/choice-${index}.mp3`,
      }),
    );
    next.id = "question-2";
    next.pronunciation = {
      ...availablePronunciation,
      audioUrl: "https://example.com/next.mp3",
    };
    quizAttempt.currentQuestionId = current.id;
    quizAttempt.questions = [current, next];

    expect(quizPreloadAudioUrls(quizAttempt)).toEqual([
      ...current.choicePronunciations.map(
        (pronunciation) => pronunciation.audioUrl,
      ),
      next.pronunciation.audioUrl,
    ]);
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
    expect(
      quizPromptDensity(
        "A person who watches an event carefully.",
        "korean_to_english",
        "canonical_definition_to_headword",
      ),
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
    expect(ANSWER_FEEDBACK_DELAY_MS).toBe(750);
    expect(ANSWER_AUDIO_END_GRACE_MS).toBe(150);
    expect(ANSWER_AUDIO_END_TIMEOUT_MS).toBe(3_000);
    expect(ANSWER_AUDIO_START_TIMEOUT_MS).toBe(1_000);
    expect(QUIZ_REQUEST_TIMEOUT_MS).toBe(2_000);
    expect(ANSWER_SERVER_FEEDBACK_RESERVATION_MS).toBe(7_000);
    expect(ANSWER_SERVER_FEEDBACK_RESERVATION_MS).toBeGreaterThanOrEqual(
      QUIZ_REQUEST_TIMEOUT_MS +
        ANSWER_AUDIO_START_TIMEOUT_MS +
        ANSWER_AUDIO_END_TIMEOUT_MS +
        ANSWER_AUDIO_END_GRACE_MS,
    );
    expect(ANSWER_RESULT_VISIBLE_MS).toBe(250);
    expect(PROMPT_AUDIO_AUTOPLAY_DELAY_MS).toBe(250);
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
