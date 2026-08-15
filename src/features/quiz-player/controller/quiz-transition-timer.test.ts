import { afterEach, describe, expect, it, vi } from "vitest";

import type { QuizAttempt } from "../model";
import {
  activeNextQuestionMilliseconds,
  previewNextQuestionMilliseconds,
} from "./quiz-transition-timer";

const perQuestionAttempt = {
  questionTimeLimitSeconds: 10,
  timingMode: "per_question",
} as QuizAttempt;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("activeNextQuestionMilliseconds", () => {
  it("caps a fast synchronization at the full per-question limit", () => {
    vi.spyOn(performance, "now").mockReturnValue(1_600);

    expect(
      activeNextQuestionMilliseconds({
        activatedAt: 1_500,
        attempt: perQuestionAttempt,
        previewMilliseconds: 10_000,
        serverMilliseconds: 10_300,
        serverReceivedAt: 1_500,
      }),
    ).toBe(10_000);
  });

  it("uses the authoritative remaining time after a slow synchronization", () => {
    vi.spyOn(performance, "now").mockReturnValue(2_000);

    expect(
      activeNextQuestionMilliseconds({
        activatedAt: 1_000,
        attempt: perQuestionAttempt,
        previewMilliseconds: 10_000,
        serverMilliseconds: 9_700,
        serverReceivedAt: 1_800,
      }),
    ).toBe(9_500);
  });
});

describe("previewNextQuestionMilliseconds", () => {
  it("does not subtract the new reservation from a legacy total timer", () => {
    expect(
      previewNextQuestionMilliseconds(
        { timingMode: "total" } as QuizAttempt,
        {
          feedbackProtocol: "legacy",
          timerRemainingMilliseconds: 12_000,
        },
      ),
    ).toBe(12_000);
  });

  it("subtracts the seven-second reservation for the variable protocol", () => {
    expect(
      previewNextQuestionMilliseconds(
        { timingMode: "total" } as QuizAttempt,
        {
          feedbackProtocol: "variable",
          timerRemainingMilliseconds: 12_000,
        },
      ),
    ).toBe(5_000);
  });
});
