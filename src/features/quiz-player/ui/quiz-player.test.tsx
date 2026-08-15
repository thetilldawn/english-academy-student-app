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
  resume: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../api/quiz-attempt", () => ({
  expireQuizAttempt: mocks.expire,
  recoverQuizAttempt: mocks.recover,
  resumeQuizAfterFeedback: mocks.resume,
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
  addEventListener: ReturnType<typeof vi.fn>;
  currentTime: number;
  emit: (type: "ended" | "error") => void;
  load: ReturnType<typeof vi.fn>;
  listeners: Map<string, Set<() => void>>;
  muted: boolean;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  playStates: Array<{ muted: boolean; src: string }>;
  preload: string;
  removeEventListener: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
  src: string;
}> = [];

const audioPlayResults: Array<
  "blocked" | "failed" | "pending" | "started"
> = [];
const pendingAudioPlays: Array<() => void> = [];

class AudioStub {
  listeners = new Map<string, Set<() => void>>();
  addEventListener = vi.fn((type: string, listener: () => void) => {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });
  currentTime = 0;
  emit(type: "ended" | "error") {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  load = vi.fn();
  muted = false;
  pause = vi.fn();
  playStates: Array<{ muted: boolean; src: string }> = [];
  play = vi.fn().mockImplementation(() => {
    this.playStates.push({ muted: this.muted, src: this.src });
    const result = audioPlayResults.shift() ?? "started";
    if (result === "blocked")
      return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    if (result === "failed") return Promise.reject(new Error("load failed"));
    if (result === "pending")
      return new Promise<void>((resolve) => pendingAudioPlays.push(resolve));
    return Promise.resolve();
  });
  preload = "";
  removeEventListener = vi.fn((type: string, listener: () => void) => {
    this.listeners.get(type)?.delete(listener);
  });
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  src = "";

  constructor() {
    audioInstances.push(this);
  }
}

function audioPlayCount() {
  return audioInstances.reduce(
    (count, audio) => count + audio.play.mock.calls.length,
    0,
  );
}

function audibleAudioPlayCount() {
  return audioInstances.reduce(
    (count, audio) =>
      count + audio.playStates.filter((state) => !state.muted).length,
    0,
  );
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
  mocks.resume.mockReset();
  mocks.submit.mockReset();
  mocks.resume.mockImplementation(async (input) =>
    successfulTransport({
      questionDeadlineAt: "2099-01-01T00:00:10.750Z",
      questionStartsAt: "2099-01-01T00:00:00.750Z",
      timerRemainingMilliseconds:
        10_000 + input.transitionRemainingMilliseconds,
      transitionRemainingMilliseconds:
        input.transitionRemainingMilliseconds,
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("QuizPlayer", () => {
  it("keeps silent feedback within 750ms without reducing the next question timer", async () => {
    const quizAttempt = attempt();
    quizAttempt.questionTimeLimitSeconds = 10;
    mocks.submit.mockResolvedValueOnce(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:10.000Z",
        timerRemainingMilliseconds: 13_000,
      }, 1_200),
    );
    await renderReady(quizAttempt);
    const initialButtonCount = screen.getAllByRole("button").length;

    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());

    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(initialButtonCount);
    expect(screen.getByText(studentAppText.attempt.correct)).toHaveClass(
      "sr-only",
    );

    act(() => vi.advanceTimersByTime(749));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:10");

    await act(async () => {
      vi.advanceTimersByTime(1_251);
      await Promise.resolve();
    });
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:09");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("moves 150ms after the correct answer audio actually ends", async () => {
    const audioAttempt = attempt();
    audioAttempt.questionTimeLimitSeconds = 10;
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:13.000Z",
        timerRemainingMilliseconds: 13_000,
      }),
    );
    mocks.resume.mockImplementation(async () =>
      successfulTransport({
        questionDeadlineAt: "2099-01-01T00:00:10.150Z",
        questionStartsAt: "2099-01-01T00:00:00.150Z",
        timerRemainingMilliseconds: 10_150,
        transitionRemainingMilliseconds: 150,
      }),
    );

    await renderReady(audioAttempt);
    const firstChoice = screen
      .getByRole("group")
      .firstElementChild!.querySelectorAll("button")[0];
    fireEvent.click(firstChoice);
    await act(async () => Promise.resolve());
    const player = audioInstances.find((audio) =>
      audio.playStates.some((state) => !state.muted),
    )!;

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await act(async () => {
      player.emit("ended");
      player.emit("error");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.resume).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      nextPhase: "initial",
      nextQuestionId: "question-2",
      transitionRemainingMilliseconds: 150,
    });

    act(() => vi.advanceTimersByTime(149));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:10");
  });

  it("shows the next question at ended plus 150ms while a slow timer sync finishes", async () => {
    const audioAttempt = attempt();
    audioAttempt.questionTimeLimitSeconds = 10;
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    mocks.submit.mockResolvedValueOnce(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:13.000Z",
        timerRemainingMilliseconds: 13_000,
      }),
    );
    mocks.submit.mockResolvedValueOnce(
      successfulTransport({
        completed: true,
        correct: true,
        correctChoiceIndex: 0,
      }),
    );
    let resolveResume: (value: unknown) => void = () => {};
    mocks.resume.mockReturnValue(
      new Promise((resolve) => {
        resolveResume = resolve;
      }),
    );

    await renderReady(audioAttempt);
    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());
    const player = audioInstances.find((audio) =>
      audio.playStates.some((state) => !state.muted),
    )!;
    await act(async () => {
      player.emit("ended");
      await Promise.resolve();
    });

    act(() => vi.advanceTimersByTime(149));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:10");
    const queuedChoice = screen.getByRole("button", {
      name: /question-2-one/,
    });
    expect(queuedChoice).toBeEnabled();
    fireEvent.click(queuedChoice);
    fireEvent.click(queuedChoice);
    expect(queuedChoice).toHaveAttribute("data-feedback", "selected");
    expect(mocks.submit).toHaveBeenCalledOnce();

    await act(async () => {
      resolveResume(
        successfulTransport(
          {
            questionDeadlineAt: "2099-01-01T00:00:10.150Z",
            questionStartsAt: "2099-01-01T00:00:00.150Z",
            timerRemainingMilliseconds: 10_300,
            transitionRemainingMilliseconds: 0,
          },
          600,
        ),
      );
      await Promise.resolve();
    });
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:10");
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        choiceIndex: 0,
        questionId: "question-2",
      }),
    );
  });

  it("recovers server timing when both audio-resume responses fail", async () => {
    const audioAttempt = attempt();
    audioAttempt.questionTimeLimitSeconds = 10;
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:13.000Z",
        timerRemainingMilliseconds: 13_000,
      }),
    );
    mocks.resume.mockRejectedValue(new Error("response lost"));

    await renderReady(audioAttempt);
    const recoveredAttempt = structuredClone(audioAttempt);
    recoveredAttempt.currentQuestionId = "question-2";
    recoveredAttempt.questions[0].initialChoiceIndex = 0;
    recoveredAttempt.questions[0].initialIsCorrect = true;
    mocks.recover.mockResolvedValue(
      successfulTransport({
        attempt: recoveredAttempt,
        timerRemainingMilliseconds: 13_000,
      }),
    );
    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());
    const player = audioInstances.find((audio) =>
      audio.playStates.some((state) => !state.muted),
    )!;
    await act(async () => {
      player.emit("ended");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.resume).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.recover).toHaveBeenCalledTimes(2);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:10");
  });

  it("moves to the result 150ms after final-answer audio ends", async () => {
    const audioAttempt = attempt();
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    mocks.submit.mockResolvedValue(
      successfulTransport({
        completed: true,
        correct: true,
        correctChoiceIndex: 0,
      }),
    );

    await renderReady(audioAttempt);
    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());
    const player = audioInstances.find((audio) =>
      audio.playStates.some((state) => !state.muted),
    )!;
    await act(async () => {
      player.emit("ended");
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(149));
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mocks.replace).toHaveBeenCalledWith("/student/result/attempt-1");
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("does not resume or transition after leaving during answer audio", async () => {
    const audioAttempt = attempt();
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:13.000Z",
        timerRemainingMilliseconds: 13_000,
      }),
    );

    const view = await renderReady(audioAttempt);
    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());
    const player = audioInstances.find((audio) =>
      audio.playStates.some((state) => !state.muted),
    )!;
    act(() => view.unmount());
    await act(async () => {
      player.emit("ended");
      vi.advanceTimersByTime(6_500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not navigate after leaving during the 150ms audio grace", async () => {
    const audioAttempt = attempt();
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    mocks.submit.mockResolvedValue(
      successfulTransport({
        completed: true,
        correct: true,
        correctChoiceIndex: 0,
      }),
    );

    const view = await renderReady(audioAttempt);
    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());
    const player = audioInstances.find((audio) =>
      audio.playStates.some((state) => !state.muted),
    )!;
    await act(async () => {
      player.emit("ended");
      await Promise.resolve();
    });
    act(() => view.unmount());
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("discards a queued next answer when leaving during timer synchronization", async () => {
    mocks.submit.mockResolvedValueOnce(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:13.000Z",
        timerRemainingMilliseconds: 13_000,
      }),
    );
    let resolveResume: (value: unknown) => void = () => {};
    mocks.resume.mockReturnValue(
      new Promise((resolve) => {
        resolveResume = resolve;
      }),
    );

    const view = await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /question-1-one/ }));
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(750);
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: /question-2-one/ }));
    act(() => view.unmount());
    await act(async () => {
      resolveResume(
        successfulTransport({
          questionDeadlineAt: "2099-01-01T00:00:10.750Z",
          questionStartsAt: "2099-01-01T00:00:00.750Z",
          timerRemainingMilliseconds: 10_000,
          transitionRemainingMilliseconds: 0,
        }),
      );
      await Promise.resolve();
    });
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("moves immediately after the 3000ms watchdog when answer audio never ends", async () => {
    const audioAttempt = attempt();
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:13.000Z",
        timerRemainingMilliseconds: 13_000,
      }),
    );
    audioPlayResults.push("started", "started");

    await renderReady(audioAttempt);
    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.resume).toHaveBeenCalledWith(
      expect.objectContaining({ transitionRemainingMilliseconds: 0 }),
    );
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    pendingAudioPlays[0]?.();
  });

  it("uses the 750ms silent fallback when correct-answer audio fails", async () => {
    const audioAttempt = attempt();
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    audioPlayResults.push("started", "failed");
    mocks.submit.mockResolvedValue(
      successfulTransport({
        correct: true,
        correctChoiceIndex: 0,
        nextPhase: "initial",
        nextQuestionId: "question-2",
        questionDeadlineAt: "2099-01-01T00:00:13.000Z",
        timerRemainingMilliseconds: 13_000,
      }),
    );

    await renderReady(audioAttempt);
    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());

    act(() => vi.advanceTimersByTime(749));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(mocks.resume).toHaveBeenCalledWith(
      expect.objectContaining({ transitionRemainingMilliseconds: 750 }),
    );
  });

  it("uses a synchronous request gate for repeated answer clicks", async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mocks.submit.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const audioAttempt = attempt();
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    await renderReady(audioAttempt);

    const firstChoice = screen
      .getByRole("group")
      .firstElementChild!.querySelectorAll("button")[0];
    fireEvent.click(firstChoice);
    fireEvent.click(firstChoice);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(firstChoice).toHaveAttribute("data-feedback", "selected");
    expect(audioPlayCount()).toBe(1);
    expect(audibleAudioPlayCount()).toBe(0);

    await act(async () => {
      resolveRequest(successfulTransport({
          completed: true,
          correct: true,
          correctChoiceIndex: 0,
        }));
      await Promise.resolve();
    });
    expect(audioPlayCount()).toBe(2);
    expect(audibleAudioPlayCount()).toBe(1);
  });

  it("auto-plays an available English prompt once after 250ms and does not replay it for a Korean answer", async () => {
    const audioAttempt = attempt();
    const current = audioAttempt.questions[0];
    current.direction = "english_to_korean";
    current.prompt = "outstanding";
    current.pronunciation = availablePronunciation;
    current.choices = ["뛰어난", "보호하다", "완전한", "구매하다"];

    const view = await renderReady(audioAttempt);

    expect(audioPlayCount()).toBe(0);
    act(() => vi.advanceTimersByTime(249));
    expect(audioPlayCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(audioPlayCount()).toBe(1);

    view.rerender(
      <QuizPlayer
        initialAttempt={audioAttempt}
        initialRemainingMilliseconds={60_000}
      />,
    );
    expect(audioPlayCount()).toBe(1);

    mocks.submit.mockResolvedValue(
      successfulTransport({
        completed: true,
        correct: true,
        correctChoiceIndex: 0,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /뛰어난/ }));
    await act(async () => Promise.resolve());
    expect(audioPlayCount()).toBe(1);
  });

  it("cancels the delayed English prompt when an answer is submitted before 250ms", async () => {
    const audioAttempt = attempt();
    const current = audioAttempt.questions[0];
    current.direction = "english_to_korean";
    current.prompt = "outstanding";
    current.pronunciation = availablePronunciation;
    current.choices = ["뛰어난", "보호하다", "완전한", "구매하다"];
    mocks.submit.mockResolvedValue(
      successfulTransport({
        completed: true,
        correct: false,
        correctChoiceIndex: 1,
      }),
    );

    await renderReady(audioAttempt);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole("button", { name: /뛰어난/ }));
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(500));

    expect(audioPlayCount()).toBe(0);
    expect(audibleAudioPlayCount()).toBe(0);
  });

  it("does not schedule English prompt audio when the synchronized timer is already zero", async () => {
    const audioAttempt = attempt();
    const current = audioAttempt.questions[0];
    current.direction = "english_to_korean";
    current.prompt = "outstanding";
    current.pronunciation = availablePronunciation;
    current.choices = ["뛰어난", "보호하다", "완전한", "구매하다"];
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

    await renderReady(audioAttempt, 0);
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(audioPlayCount()).toBe(0);
    expect(audibleAudioPlayCount()).toBe(0);
  });

  it("previews from the speaker without submitting and plays once again when choosing the English answer", async () => {
    const audioAttempt = attempt();
    const current = audioAttempt.questions[0];
    current.choicePronunciations = Array.from(
      { length: 4 },
      () => availablePronunciation,
    );
    mocks.submit.mockResolvedValue(
      successfulTransport({
        completed: true,
        correct: true,
        correctChoiceIndex: 0,
      }),
    );

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
    await act(async () => Promise.resolve());
    expect(player?.play).toHaveBeenCalledTimes(3);
    expect(player?.playStates.map((state) => state.muted)).toEqual([
      false,
      true,
      false,
    ]);
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
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    const player = audioInstances.find((audio) =>
      audio.play.mock.calls.length > 0
    );
    expect(player?.play).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /english-1 발음/ }));
    expect(player?.play).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: /하나/ }));
    await act(async () => Promise.resolve());
    expect(player?.play).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(750));
    await act(async () => Promise.resolve());

    expect(screen.getByText("english-2")).toBeInTheDocument();
    expect(player?.play).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(player?.play).toHaveBeenCalledTimes(3);
  });

  it("starts the next prompt 250ms after the screen changes even while timer sync is slow", async () => {
    const audioAttempt = attempt();
    for (const current of audioAttempt.questions) {
      current.choicePronunciations = Array.from({ length: 4 }, (_, index) => ({
        ...availablePronunciation,
        audioUrl: `https://example.com/${current.id}-${index}.mp3`,
      }));
    }
    audioAttempt.questions[1].direction = "english_to_korean";
    audioAttempt.questions[1].prompt = "next-english-prompt";
    audioAttempt.questions[1].pronunciation = {
      ...availablePronunciation,
      audioUrl: "https://example.com/next-prompt.mp3",
    };
    audioAttempt.questions[1].choices = ["하나", "둘", "셋", "넷"];
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
    let resolveResume: (value: unknown) => void = () => {};
    mocks.resume.mockReturnValue(
      new Promise((resolve) => {
        resolveResume = resolve;
      }),
    );

    await renderReady(audioAttempt);
    const firstRow = screen.getByRole("group").firstElementChild;
    const rowButtons = firstRow!.querySelectorAll("button");
    fireEvent.click(rowButtons[0]);
    await act(async () => Promise.resolve());
    const player = audioInstances.find((audio) =>
      audio.play.mock.calls.length > 0
    );
    const pauseCount = player?.pause.mock.calls.length;
    expect(player?.play).toHaveBeenCalledTimes(2);
    expect(player?.playStates.map((state) => state.muted)).toEqual([
      true,
      false,
    ]);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await act(async () => {
      player?.emit("ended");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.resume).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(149));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(screen.getByText("next-english-prompt")).toBeInTheDocument();
    expect(player?.pause).toHaveBeenCalledTimes(pauseCount ?? 0);
    act(() => vi.advanceTimersByTime(249));
    expect(player?.pause).toHaveBeenCalledTimes(pauseCount ?? 0);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(player?.pause).toHaveBeenCalledTimes((pauseCount ?? 0) + 1);
    expect(player?.src).toBe("https://example.com/next-prompt.mp3");
    await act(async () => {
      resolveResume(
        successfulTransport({
          questionDeadlineAt: "2099-01-01T00:00:10.150Z",
          questionStartsAt: "2099-01-01T00:00:00.150Z",
          timerRemainingMilliseconds: 10_000,
          transitionRemainingMilliseconds: 0,
        }),
      );
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(500));
    expect(player?.play).toHaveBeenCalledTimes(3);
  });

  it("locks choices at zero and shows a timeout notice for 750ms", async () => {
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
    expect(
      screen.getByRole("button", { name: /question-1-one/ }),
    ).toBeDisabled();
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

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(
      screen.queryByTestId("quiz-timeout-overlay"),
    ).not.toBeInTheDocument();
  });

  it("shows timeout immediately and does not add another 750ms after a slow request", async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mocks.submit.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    await renderReady(attempt(), 0);

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
    expect(screen.getByTestId("quiz-timeout-overlay")).toHaveTextContent(
      studentAppText.attempt.timeoutTitle,
    );

    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await act(async () => {
      resolveRequest(
        successfulTransport({
          correct: false,
          correctChoiceIndex: 1,
          nextPhase: "initial",
          nextQuestionId: "question-2",
          questionDeadlineAt: "2099-01-01T00:00:13.000Z",
          timedOut: true,
          timerRemainingMilliseconds: 13_000,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(
      screen.queryByTestId("quiz-timeout-overlay"),
    ).not.toBeInTheDocument();
  });

  it("announces a wrong answer without playing its English choice audio", async () => {
    mocks.submit.mockResolvedValue(
      successfulTransport({
        completed: true,
        correct: false,
        correctChoiceIndex: 1,
      }),
    );
    const audioAttempt = attempt();
    audioAttempt.questions[0].choicePronunciations[0] =
      availablePronunciation;
    await renderReady(audioAttempt);

    fireEvent.click(
      screen
        .getByRole("group")
        .firstElementChild!.querySelectorAll("button")[0],
    );
    await act(async () => Promise.resolve());

    expect(audioPlayCount()).toBe(1);
    expect(audibleAudioPlayCount()).toBe(0);
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
    expect(audioPlayCount()).toBe(0);
    act(() => vi.advanceTimersByTime(249));
    expect(audioPlayCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(audioPlayCount()).toBe(1);
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
