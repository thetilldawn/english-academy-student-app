// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { studentAppText } from "@/content/ko/student-app";

import type { QuizAttempt, QuizQuestion } from "../model";
import { QuizPlayer } from "./quiz-player";

const mocks = vi.hoisted(() => ({
  expire: vi.fn(),
  recover: vi.fn(),
  replace: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../api/quiz-attempt", () => ({
  expireQuizAttempt: mocks.expire,
  recoverQuizAttempt: mocks.recover,
  submitQuizAnswer: mocks.submit,
}));

const unavailablePronunciation = {
  audioUrl: null,
  available: false,
  displayKo: null,
  variantId: null,
} as const;

const availablePronunciation = {
  audioUrl: "https://example.com/audio.mp3",
  available: true,
  displayKo: "테스트",
  variantId: "test:1",
} as const;

const audioInstances: Array<{
  currentTime: number;
  load: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  preload: string;
  removeAttribute: ReturnType<typeof vi.fn>;
  src: string;
}> = [];

const audioPlayResults: Array<
  "blocked" | "failed" | "pending" | "started"
> = [];
const pendingAudioPlays: Array<() => void> = [];

class AudioStub {
  currentTime = 0;
  load = vi.fn();
  pause = vi.fn();
  play = vi.fn().mockImplementation(() => {
    const result = audioPlayResults.shift() ?? "started";
    if (result === "blocked")
      return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    if (result === "failed") return Promise.reject(new Error("load failed"));
    if (result === "pending")
      return new Promise<void>((resolve) => pendingAudioPlays.push(resolve));
    return Promise.resolve();
  });
  preload = "";
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  src = "";

  constructor() {
    audioInstances.push(this);
  }
}

function question(id: string, orderIndex: number): QuizQuestion {
  return {
    choicePronunciations: Array.from(
      { length: 4 },
      () => unavailablePronunciation,
    ),
    choices: [`${id}-one`, `${id}-two`, `${id}-three`, `${id}-four`],
    direction: "korean_to_english",
    id,
    initialChoiceIndex: null,
    initialIsCorrect: null,
    initialTimedOut: false,
    orderIndex,
    priorWrongLevel: 0,
    prompt: `${id}-prompt`,
    pronunciation: unavailablePronunciation,
    retryChoiceIndex: null,
    retryIsCorrect: null,
    retryTimedOut: false,
    revealedCorrectChoiceIndex: null,
  };
}

function attempt(): QuizAttempt {
  return {
    assignmentTitle: "Stable quiz",
    currentQuestionId: "question-1",
    deadlineAt: "2099-01-01T00:10:00.000Z",
    id: "attempt-1",
    phase: "initial",
    questionTimeLimitSeconds: 60,
    questions: [question("question-1", 1), question("question-2", 2)],
    startedAt: "2099-01-01T00:00:00.000Z",
    status: "in_progress",
    timerDeadlineAt: "2099-01-01T00:01:00.000Z",
    timingMode: "per_question",
  };
}

function successfulTransport<T>(
  payload: T,
  roundTripMilliseconds = 0,
) {
  return {
    ok: true as const,
    payload,
    receivedAt: performance.now(),
    roundTripMilliseconds,
  };
}

async function renderReady(
  quizAttempt = attempt(),
  remainingMilliseconds = 60_000,
) {
  mocks.recover.mockImplementation(async () =>
    successfulTransport({
      attempt: quizAttempt,
      timerRemainingMilliseconds: remainingMilliseconds,
    }),
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <QuizPlayer
        initialAttempt={quizAttempt}
        initialRemainingMilliseconds={remainingMilliseconds}
      />,
    );
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Audio", AudioStub);
  audioInstances.length = 0;
  audioPlayResults.length = 0;
  pendingAudioPlays.length = 0;
  mocks.expire.mockReset();
  mocks.recover.mockReset();
  mocks.replace.mockReset();
  mocks.submit.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("QuizPlayer", () => {
  it("keeps the same question structure for 750ms and then starts the next server timer", async () => {
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:10.000Z",
        timerRemainingMilliseconds: 10_800,
      }, 300),
    );
    await renderReady();
    const initialButtonCount = screen.getAllByRole("button").length;

    fireEvent.click(
      screen.getByRole("button", { name: /question-1-one/ }),
    );
    await act(async () => Promise.resolve());

    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(initialButtonCount);
    expect(screen.getByText(studentAppText.attempt.correct)).toHaveClass(
      "sr-only",
    );

    act(() => vi.advanceTimersByTime(749));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:10");

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:09");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("uses a synchronous request gate for repeated answer clicks", async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mocks.submit.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    await renderReady();

    const firstChoice = screen.getByRole("button", {
      name: /question-1-one/,
    });
    fireEvent.click(firstChoice);
    fireEvent.click(firstChoice);
    expect(mocks.submit).toHaveBeenCalledOnce();

    await act(async () => {
      resolveRequest(successfulTransport({
          completed: true,
          correct: true,
          correctChoiceIndex: 0,
        }));
      await Promise.resolve();
    });
  });

  it("auto-plays an available English prompt only once", async () => {
    const audioAttempt = attempt();
    const current = audioAttempt.questions[0];
    current.direction = "english_to_korean";
    current.prompt = "outstanding";
    current.pronunciation = availablePronunciation;
    current.choices = ["뛰어난", "보호하다", "완전한", "구매하다"];

    const view = await renderReady(audioAttempt);

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0]?.src).toBe(availablePronunciation.audioUrl);
    expect(audioInstances[0]?.play).toHaveBeenCalledOnce();

    view.rerender(
      <QuizPlayer
        initialAttempt={audioAttempt}
        initialRemainingMilliseconds={60_000}
      />,
    );
    expect(audioInstances[0]?.play).toHaveBeenCalledOnce();
  });

  it("keeps a choice speaker separate from choosing an English answer", async () => {
    const audioAttempt = attempt();
    const current = audioAttempt.questions[0];
    current.choicePronunciations = Array.from(
      { length: 4 },
      () => availablePronunciation,
    );
    mocks.submit.mockReturnValue(new Promise(() => {}));

    await renderReady(audioAttempt);

    const choiceGroup = screen.getByRole("group");
    const firstRow = choiceGroup.firstElementChild;
    const rowButtons = firstRow?.querySelectorAll("button");
    expect(rowButtons).toHaveLength(2);

    fireEvent.click(rowButtons![1]);
    const player = audioInstances.find((audio) =>
      audio.play.mock.calls.length > 0
    );
    expect(player?.play).toHaveBeenCalledOnce();
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.click(rowButtons![0]);
    expect(player?.play).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it("retries future prompt autoplay after a browser-blocked first prompt", async () => {
    const audioAttempt = attempt();
    for (const [index, current] of audioAttempt.questions.entries()) {
      current.direction = "english_to_korean";
      current.prompt = `english-${index + 1}`;
      current.pronunciation = {
        ...availablePronunciation,
        audioUrl: `https://example.com/audio-${index + 1}.mp3`,
      };
      current.choices = ["하나", "둘", "셋", "넷"];
    }
    audioPlayResults.push("blocked", "started", "started");
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:10.000Z",
        timerRemainingMilliseconds: 10_000,
      }),
    );

    await renderReady(audioAttempt);
    const player = audioInstances.find((audio) =>
      audio.play.mock.calls.length > 0
    );
    expect(player?.play).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /english-1 발음/ }));
    expect(player?.play).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: /하나/ }));
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(750));
    await act(async () => Promise.resolve());

    expect(screen.getByText("english-2")).toBeInTheDocument();
    expect(player?.play).toHaveBeenCalledTimes(3);
  });

  it("keeps manually played English audio playing across the 750ms transition", async () => {
    const audioAttempt = attempt();
    for (const current of audioAttempt.questions) {
      current.choicePronunciations = Array.from({ length: 4 }, (_, index) => ({
        ...availablePronunciation,
        audioUrl: `https://example.com/${current.id}-${index}.mp3`,
      }));
    }
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:10.000Z",
        timerRemainingMilliseconds: 10_000,
      }),
    );
    audioPlayResults.push("pending");

    await renderReady(audioAttempt);
    const firstRow = screen.getByRole("group").firstElementChild;
    const rowButtons = firstRow!.querySelectorAll("button");
    fireEvent.click(rowButtons[1]);
    const player = audioInstances.find((audio) =>
      audio.play.mock.calls.length > 0
    );
    const pauseCount = player?.pause.mock.calls.length;
    fireEvent.click(rowButtons[0]);
    expect(player?.play).toHaveBeenCalledOnce();
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(750));

    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(player?.pause).toHaveBeenCalledTimes(pauseCount ?? 0);
    pendingAudioPlays[0]?.();
  });

  it("shows a timeout notice for 750ms and records no answer as wrong", async () => {
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: false,
        correctChoiceIndex: 1,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:10.000Z",
        timedOut: true,
        timerRemainingMilliseconds: 10_000,
      }),
    );

    await renderReady(attempt(), 0);
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ choiceIndex: null }),
    );
    expect(screen.getByTestId("quiz-timeout-overlay")).toHaveTextContent(
      studentAppText.attempt.timeoutTitle,
    );
    expect(screen.getByText(studentAppText.attempt.timedOut)).toHaveClass(
      "sr-only",
    );
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(749));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(
      screen.queryByTestId("quiz-timeout-overlay"),
    ).not.toBeInTheDocument();
  });

  it("announces a wrong answer without adding visible feedback copy", async () => {
    mocks.submit.mockResolvedValue(
      successfulTransport({
        completed: true,
        correct: false,
        correctChoiceIndex: 1,
      }),
    );
    await renderReady();

    fireEvent.click(
      screen.getByRole("button", { name: /question-1-one/ }),
    );
    await act(async () => Promise.resolve());

    expect(screen.getByText(studentAppText.attempt.wrongInitial)).toHaveClass(
      "sr-only",
    );
    expect(document.querySelector(".quiz-error")).toBeNull();
  });

  it("locks answers until the initial server timer is conservatively synchronized", async () => {
    let resolveRecovery: (value: unknown) => void = () => {};
    const quizAttempt = attempt();
    quizAttempt.questions[0].direction = "english_to_korean";
    quizAttempt.questions[0].pronunciation = availablePronunciation;
    mocks.recover.mockReturnValue(
      new Promise((resolve) => {
        resolveRecovery = resolve;
      }),
    );

    render(
      <QuizPlayer
        initialAttempt={quizAttempt}
        initialRemainingMilliseconds={60_000}
      />,
    );
    const firstChoice = screen.getByRole("button", {
      name: /question-1-one/,
    });
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("--:--");
    expect(firstChoice).toBeDisabled();
    expect(audioInstances[0]?.play).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("group").closest("section")!, {
      key: "1",
    });
    expect(mocks.submit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_200));
    await act(async () => {
      resolveRecovery({
        ok: true,
        payload: {
          attempt: quizAttempt,
          timerRemainingMilliseconds: 10_000,
        },
        receivedAt: performance.now(),
        roundTripMilliseconds: 1_200,
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:09");
    expect(firstChoice).toBeEnabled();
    expect(audioInstances[0]?.play).toHaveBeenCalledOnce();
  });

  it("keeps answers locked and lets the student retry a failed initial synchronization", async () => {
    const quizAttempt = attempt();
    mocks.recover
      .mockResolvedValueOnce({
        ok: false,
        payload: { error: "temporary failure" },
        receivedAt: performance.now(),
        roundTripMilliseconds: 100,
      })
      .mockResolvedValueOnce(
        successfulTransport({
          attempt: quizAttempt,
          timerRemainingMilliseconds: 30_000,
        }),
      );

    render(
      <QuizPlayer
        initialAttempt={quizAttempt}
        initialRemainingMilliseconds={60_000}
      />,
    );
    await act(async () => Promise.resolve());

    const firstChoice = screen.getByRole("button", {
      name: /question-1-one/,
    });
    expect(firstChoice).toBeDisabled();
    const retry = screen.getByRole("button", {
      name: studentAppText.attempt.synchronizationRetry,
    });

    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
    });

    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:30");
    expect(firstChoice).toBeEnabled();
    expect(
      screen.queryByRole("button", {
        name: studentAppText.attempt.synchronizationRetry,
      }),
    ).not.toBeInTheDocument();
  });
});
