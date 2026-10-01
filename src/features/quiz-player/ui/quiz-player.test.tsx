// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { studentAppText } from "@/content/ko/student-app";

import type { QuizAttempt, QuizQuestion, QuizAnswerResponse } from "../model";
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
    quizContentMode: "book_meaning_choice",
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

async function waitForAnswerSelection(milliseconds = 20) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
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
  it.each(["initial", "retry"] as const)("waits out unrecovered feedback without adding it to total time in %s", async phase => {
    const value = attempt();
    value.phase = phase; value.timingMode = "total"; value.questionTimeLimitSeconds = null;
    if (phase === "retry") value.questions.forEach(q => { q.initialChoiceIndex = 1; q.initialIsCorrect = false; });
    mocks.recover.mockImplementation(async () => successfulTransport({
      attempt: value, timerRemainingMilliseconds: 240_000, transitionRemainingMilliseconds: 6_000,
    }));
    await act(async () => { render(<QuizPlayer initialAttempt={value} initialRemainingMilliseconds={240_000} />); });
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("--:--");
    const choice = screen.getByRole("button", { name: /^1\s*question-1-one/ });
    expect(choice).toBeDisabled();
    fireEvent.click(choice);
    await waitForAnswerSelection(5_999);
    expect(choice).toBeDisabled();
    expect(mocks.submit).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("3:54");
    expect(choice).toBeEnabled();
  });

  it.each([5, 8, 10])("keeps the full %s-second question budget after a reserved transition", async seconds => {
    const value = attempt(); value.questionTimeLimitSeconds = seconds;
    mocks.recover.mockImplementation(async () => successfulTransport({
      attempt: value, timerRemainingMilliseconds: seconds * 1_000 + 6_000, transitionRemainingMilliseconds: 6_000,
    }));
    await act(async () => { render(<QuizPlayer initialAttempt={value} initialRemainingMilliseconds={99_000} />); });
    await waitForAnswerSelection(6_000);
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent(seconds === 10 ? "0:10" : "0:0" + seconds);
    expect(screen.getByRole("button", { name: /^1\s*question-1-one/ })).toBeEnabled();
  });

  it("does not deduct the reservation again after the server acknowledged but its response was lost", async () => {
    const value = attempt(); value.timingMode = "total";
    mocks.recover.mockImplementation(async () => successfulTransport({
      attempt: value, timerRemainingMilliseconds: 234_000, transitionRemainingMilliseconds: 0,
    }));
    await act(async () => { render(<QuizPlayer initialAttempt={value} initialRemainingMilliseconds={240_000} />); });
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("3:54");
    expect(screen.getByRole("button", { name: /^1\s*question-1-one/ })).toBeEnabled();
  });

  it("does not resume or send anything after leaving during recovery waiting", async () => {
    mocks.recover.mockImplementation(async () => successfulTransport({
      attempt: attempt(), timerRemainingMilliseconds: 16_000, transitionRemainingMilliseconds: 6_000,
    }));
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<QuizPlayer initialAttempt={attempt()} initialRemainingMilliseconds={16_000} />); });
    await waitForAnswerSelection(1_000);
    view.unmount();
    await waitForAnswerSelection(10_000);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("refuses a recovery reservation outside the server limit", async () => {
    mocks.recover.mockImplementation(async () => successfulTransport({
      attempt: attempt(), timerRemainingMilliseconds: 99_000, transitionRemainingMilliseconds: 7_251,
    }));
    await act(async () => { render(<QuizPlayer initialAttempt={attempt()} initialRemainingMilliseconds={99_000} />); });
    await waitForAnswerSelection(10_000);
    expect(screen.getByRole("button", { name: /^1\s*question-1-one/ })).toBeDisabled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["initial", "retry"] as const)("sends only the last choice 20ms after the last click in %s", async (phase) => {
    const value = attempt();
    value.phase = phase;
    if (phase === "retry") value.questions.forEach((item) => {
      item.initialChoiceIndex = 1;
      item.initialIsCorrect = false;
    });
    mocks.submit.mockReturnValue(new Promise(() => {}));
    await renderReady(value);
    const first = screen.getByRole("button", { name: /^1\s*question-1-one/ });
    const last = screen.getByRole("button", { name: /question-1-three/ });
    fireEvent.click(first);
    await waitForAnswerSelection(19);
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.click(last);
    expect(first).not.toHaveAttribute("data-feedback", "selected");
    expect(last).toHaveAttribute("data-feedback", "selected");
    expect(last).toBeEnabled();
    expect(screen.queryByText(studentAppText.attempt.correct)).toBeNull();
    await waitForAnswerSelection(19);
    expect(mocks.submit).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
      attemptId: value.id, questionId: "question-1", phase, choiceIndex: 2,
    });
    expect(last).toBeDisabled();
    fireEvent.click(first);
    await waitForAnswerSelection(1_000);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("cancels an unsent selection on unmount", async () => {
    const view = await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(19);
    view.unmount();
    await waitForAnswerSelection(1_000);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it.each(["per_question", "total", "none"] as const)("does not let %s expiry replace a pre-deadline choice", async (timingMode) => {
    const value = attempt();
    value.timingMode = timingMode;
    mocks.submit.mockReturnValue(new Promise(() => {}));
    await renderReady(value, 10);
    fireEvent.click(screen.getByRole("button", { name: /question-1-two/ }));
    await waitForAnswerSelection(11);
    const other = screen.getByRole("button", { name: /question-1-three/ });
    expect(other).toBeDisabled();
    fireEvent.click(other);
    await waitForAnswerSelection(8);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.expire).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ choiceIndex: 1 }));
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it("keeps an untimed attempt open without starting a countdown", async () => {
    const quizAttempt = attempt();
    quizAttempt.deadlineAt = "infinity";
    quizAttempt.timerDeadlineAt = "infinity";
    quizAttempt.timingMode = "none";
    quizAttempt.questionTimeLimitSeconds = null;

    await renderReady(quizAttempt, 0);

    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("제한 없음");
    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1_000));
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
  });

  it("expires an untimed attempt once when its assignment deadline passes", async () => {
    const quizAttempt = attempt();
    quizAttempt.deadlineAt = "2099-01-01T00:10:00.000Z";
    quizAttempt.timerDeadlineAt = quizAttempt.deadlineAt;
    quizAttempt.timingMode = "none";
    quizAttempt.questionTimeLimitSeconds = null;
    mocks.expire.mockResolvedValue({ ok: true });

    await renderReady(quizAttempt, 2_000);
    act(() => vi.advanceTimersByTime(1_999));
    expect(mocks.expire).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("제한 없음");
    expect(mocks.expire).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith(
      "/student/result/attempt-1",
    );

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    expect(mocks.expire).toHaveBeenCalledTimes(1);
  });


  const variants = (["initial", "retry"] as const).flatMap(phase =>
    [false, true].flatMap(correct =>
      [false, true].flatMap(audio =>
        (["variable", "legacy"] as const).map(protocol => ({ phase, correct, audio, protocol })))));
  it.each(variants)("shows $phase correct=$correct audio=$audio $protocol for 200ms without replay or skip", async ({ phase, correct, audio, protocol }) => {
    const value = attempt(); value.phase = phase;
    if (phase === "retry") value.questions.forEach(q => { q.initialChoiceIndex = 1; q.initialIsCorrect = false; });
    if (audio) value.questions[0].choicePronunciations[0] = availablePronunciation;
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer({ correct, nextPhase: phase, feedbackProtocol: protocol })));
    await renderReady(value);
    const selected = screen.getByRole("button", { name: /^1\s*question-1-one/ });
    fireEvent.click(selected);
    await waitForAnswerSelection();
    expect(selected).toHaveAttribute("data-feedback", correct ? "correct" : "wrong");
    expect(selected).toBeDisabled();
    expect(screen.queryByText(studentAppText.attempt.skipAudio)).toBeNull();
    expect(audioPlayCount()).toBe(0);
    fireEvent.click(selected);
    fireEvent.keyDown(screen.getByRole("group"), { key: "2" });
    fireEvent.pointerDown(selected, { pointerType: "touch" });
    await waitForAnswerSelection(199);
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await waitForAnswerSelection(1);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    fireEvent.pointerUp(selected, { pointerType: "touch" });
    fireEvent.click(selected);
    await waitForAnswerSelection(30);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    if (protocol === "legacy") expect(mocks.resume).not.toHaveBeenCalled();
    else expect(mocks.resume).toHaveBeenCalledWith(expect.objectContaining({ transitionRemainingMilliseconds: 200 }));
  });

  it.each(["completed", "needsRetry"] as const)("waits 200ms before the final %s result", async terminal => {
    mocks.submit.mockImplementation(async () => successfulTransport({
      correct: terminal === "completed", correctChoiceIndex: 0, [terminal]: true,
    }));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection();
    await waitForAnswerSelection(199);
    expect(mocks.replace).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/student/result/attempt-1");
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("starts the full 200ms with the result even when saving is slow", async () => {
    let finish!: (value: unknown) => void;
    mocks.submit.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await renderReady();
    const selected = screen.getByRole("button", { name: /^1\s*question-1-one/ });
    fireEvent.click(selected); await waitForAnswerSelection();
    await waitForAnswerSelection(1_500);
    expect(selected).toHaveAttribute("data-feedback", "selected");
    await act(async () => { finish(successfulTransport(nextAnswer())); });
    expect(selected).toHaveAttribute("data-feedback", "correct");
    await waitForAnswerSelection(199);
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await waitForAnswerSelection(1);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
  });

  it("restarts 20ms for the same choice and sends once", async () => {
    mocks.submit.mockReturnValue(new Promise(() => {}));
    await renderReady();
    const selected = screen.getByRole("button", { name: /^1\s*question-1-one/ });
    fireEvent.click(selected); await waitForAnswerSelection(19);
    fireEvent.click(selected); await waitForAnswerSelection(19);
    expect(mocks.submit).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    fireEvent.click(selected); await waitForAnswerSelection(200);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("keeps the last next-question choice until slow readiness, settled=%s", async settled => {
    let finish!: (value: unknown) => void;
    mocks.submit.mockImplementationOnce(async () => successfulTransport(nextAnswer()))
      .mockReturnValue(new Promise(() => {}));
    mocks.resume.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    const next = screen.getByRole("button", { name: /question-2-three/ });
    fireEvent.click(screen.getByRole("button", { name: /question-2-two/ }));
    await waitForAnswerSelection(10); fireEvent.click(next);
    await waitForAnswerSelection(settled ? 50 : 19);
    expect(next).toHaveAttribute("data-feedback", "selected");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await act(async () => { finish(successfulTransport({
      questionDeadlineAt: "2099-01-01T00:00:10.000Z", questionStartsAt: "2099-01-01T00:00:00.000Z",
      timerRemainingMilliseconds: 10_000, transitionRemainingMilliseconds: 0,
    })); });
    if (!settled) expect(mocks.submit).toHaveBeenCalledTimes(1);
    await waitForAnswerSelection(1);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ questionId: "question-2", choiceIndex: 2 }));
  });

  it("discards a pending next answer on recovery, and never repeats shown feedback", async () => {
    let finish!: (value: unknown) => void;
    const value = attempt(), restored = savedAttempt(value, false);
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer()));
    mocks.resume.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ ok: false, payload: {} });
    await renderReady(value);
    mocks.recover.mockImplementation(async () => successfulTransport({ attempt: restored, timerRemainingMilliseconds: 10_000 }));
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    fireEvent.click(screen.getByRole("button", { name: /question-2-two/ }));
    await waitForAnswerSelection(20);
    await act(async () => { finish({ ok: false, payload: {} }); });
    expect(screen.getByRole("button", { name: /question-2-two/ })).toHaveAttribute("data-feedback", "idle");
    await waitForAnswerSelection(250);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
  });

  it("abandons a queued answer on unmount while readiness is pending", async () => {
    let finish!: (value: unknown) => void;
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer()));
    mocks.resume.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    fireEvent.click(screen.getByRole("button", { name: /question-2-two/ }));
    view.unmount();
    await act(async () => { finish({ ok: false, payload: {} }); });
    await waitForAnswerSelection(5_000);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.resume).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not navigate after leaving during acknowledged feedback, terminal=%s", async terminal => {
    mocks.submit.mockImplementation(async () => successfulTransport(terminal
      ? { correct: true, correctChoiceIndex: 0, completed: true } : nextAnswer()));
    const view = await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(199);
    view.unmount(); await waitForAnswerSelection(5_000);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it.each(["book_meaning_choice", "canonical_definition_to_headword", "canonical_example_to_headword"] as const)("does not play any selected English answer in %s", async quizContentMode => {
    const value = attempt(); value.quizContentMode = quizContentMode;
    value.questions[0].choicePronunciations[0] = availablePronunciation;
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer({ correct: false })));
    await renderReady(value);
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    expect(audioPlayCount()).toBe(0);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
  });

  it("preserves manual speakers but stops replay started inside the 20ms window", async () => {
    const value = attempt(); value.questions[0].choicePronunciations[0] = availablePronunciation;
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer()));
    await renderReady(value);
    const speaker = screen.getByRole("button", { name: /question-1-one.*발음/ });
    fireEvent.click(speaker); await act(async () => {});
    expect(audibleAudioPlayCount()).toBe(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    fireEvent.click(speaker); await act(async () => {});
    const player = audioInstances.find(audio => audio.playStates.length > 0)!;
    player.pause.mockClear();
    await waitForAnswerSelection();
    expect(player.pause).toHaveBeenCalled();
    await waitForAnswerSelection(200);
    expect(audibleAudioPlayCount()).toBe(2);
  });

  it.each(["started", "blocked", "failed", "pending"] as const)("does not wait for a %s prompt audio and keeps next prompt autoplay", async outcome => {
    const value = attempt();
    value.questions.forEach((q, index) => { q.direction = "english_to_korean"; q.pronunciation = { ...availablePronunciation, audioUrl: "https://example.com/prompt-" + index + ".mp3" }; });
    audioPlayResults.push(outcome);
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer()));
    await renderReady(value); await waitForAnswerSelection(250);
    const player = audioInstances.find(audio => audio.playStates.length > 0)!;
    player.pause.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection();
    expect(player.pause).toHaveBeenCalled();
    await waitForAnswerSelection(199);
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    await waitForAnswerSelection(1);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    await waitForAnswerSelection(250);
    expect(audibleAudioPlayCount()).toBe(2);
    for (const finish of pendingAudioPlays) finish();
    await act(async () => {});
    player.emit("ended"); player.emit("error");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("cancels not-yet-played prompt audio on early selection", async () => {
    const value = attempt(); value.questions[0].direction = "english_to_korean";
    value.questions[0].pronunciation = availablePronunciation;
    mocks.submit.mockReturnValue(new Promise(() => {}));
    await renderReady(value);
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(1_000);
    expect(audioPlayCount()).toBe(0);
  });

  const recoverCases = (["initial", "retry"] as const).flatMap(phase =>
    [false, true].flatMap(correct => [false, true].map(terminal => ({ phase, correct, terminal }))));
  it.each(recoverCases)("restores saved $phase correct=$correct terminal=$terminal feedback after a lost answer response", async ({ phase, correct, terminal }) => {
    const value = attempt(); value.phase = phase;
    if (phase === "retry") value.questions.forEach(q => { q.initialChoiceIndex = 1; q.initialIsCorrect = false; });
    mocks.submit.mockRejectedValue(new Error("response lost"));
    await renderReady(value);
    const restored = savedAttempt(value, correct, terminal);
    mocks.recover.mockImplementation(async () => successfulTransport({ attempt: restored, timerRemainingMilliseconds: 10_000 }));
    const selected = screen.getByRole("button", { name: /^1\s*question-1-one/ });
    fireEvent.click(selected); await waitForAnswerSelection();
    expect(selected).toHaveAttribute("data-feedback", correct ? "correct" : "wrong");
    await waitForAnswerSelection(199);
    expect(screen.getByText("question-1-prompt")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    if (terminal) expect(mocks.replace).toHaveBeenCalledWith("/student/result/attempt-1");
    else expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.recover).toHaveBeenCalledTimes(2);
  });

  it("restores a saved timeout even when the server rewrote its choice index", async () => {
    const value = attempt(), restored = savedAttempt(value, false);
    restored.questions[0].initialTimedOut = true; restored.questions[0].initialChoiceIndex = 3;
    mocks.submit.mockRejectedValue(new Error("lost"));
    await renderReady(value);
    mocks.recover.mockImplementation(async () => successfulTransport({ attempt: restored, timerRemainingMilliseconds: 10_000 }));
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection();
    expect(screen.getByText(studentAppText.attempt.timeoutTitle)).toBeInTheDocument();
    await waitForAnswerSelection(200);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
  });

  it.each(["unanswered", "different-choice", "no-correct-index", "different-phase"] as const)("does not invent recovered feedback for %s", async mismatch => {
    const value = attempt(), restored = attempt();
    restored.questions[0].revealedCorrectChoiceIndex = 0;
    if (mismatch !== "unanswered") {
      restored.questions[0].initialChoiceIndex = mismatch === "different-choice" ? 2 : 0;
      restored.questions[0].initialIsCorrect = true;
    }
    if (mismatch === "no-correct-index") restored.questions[0].revealedCorrectChoiceIndex = null;
    if (mismatch === "different-phase") {
      restored.questions[0].initialIsCorrect = null;
      restored.questions[0].retryIsCorrect = true; restored.questions[0].retryChoiceIndex = 0;
    }
    mocks.submit.mockRejectedValue(new Error("lost"));
    await renderReady(value);
    mocks.recover.mockImplementation(async () => successfulTransport({ attempt: restored, timerRemainingMilliseconds: 10_000 }));
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection();
    expect(screen.getByRole("button", { name: /^1\s*question-1-one/ })).toHaveAttribute("data-feedback", "idle");
    expect(screen.queryByText(studentAppText.attempt.correct)).toBeNull();
  });

  it("counts restored feedback time against a finite total deadline", async () => {
    const value = attempt(); value.timingMode = "total"; value.questionTimeLimitSeconds = null;
    const restored = savedAttempt(value, true);
    mocks.submit.mockRejectedValue(new Error("lost")); await renderReady(value);
    mocks.recover.mockImplementation(async () => successfulTransport({ attempt: restored, timerRemainingMilliseconds: 1_100 }));
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:01");
  });

  it("does not navigate if unmounted while recovered terminal feedback is visible", async () => {
    const value = attempt(); mocks.submit.mockRejectedValue(new Error("lost"));
    const view = await renderReady(value);
    mocks.recover.mockImplementation(async () => successfulTransport({ attempt: savedAttempt(value, true, true), timerRemainingMilliseconds: 0 }));
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); view.unmount();
    await waitForAnswerSelection(1_000);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("uses the custom practice transport and result route with the same 20/200ms contract", async () => {
    const value = attempt();
    const practice = {
      answer: vi.fn(async () => successfulTransport({ correct: true, correctChoiceIndex: 0, completed: true })),
      read: vi.fn(async () => successfulTransport({ attempt: value, timerRemainingMilliseconds: 60_000 })),
      feedback: mocks.resume, expire: mocks.expire,
      resultHref: (id: string) => "/student/practice/" + id + "/result",
    };
    await act(async () => { render(<QuizPlayer initialAttempt={value} initialRemainingMilliseconds={60_000} transport={practice} />); });
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(19);
    expect(practice.answer).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    expect(practice.answer).toHaveBeenCalledTimes(1);
    await waitForAnswerSelection(199);
    expect(mocks.replace).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    expect(mocks.replace).toHaveBeenCalledWith("/student/practice/attempt-1/result");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("keeps the existing safe error when saving and recovery both fail", async () => {
    mocks.submit.mockRejectedValue(new Error(studentAppText.attempt.saveError));
    await renderReady(); mocks.recover.mockRejectedValue(new Error("unavailable"));
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection();
    expect(screen.getByText(studentAppText.attempt.saveError)).toBeInTheDocument();
    expect(screen.queryByText(studentAppText.attempt.skipAudio)).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });


  it.each([5, 8, 10])("preserves a legacy %s-second budget while showing the next question at 200ms", async seconds => {
    const value = attempt(); value.questionTimeLimitSeconds = seconds;
    mocks.submit.mockImplementationOnce(async () => successfulTransport(nextAnswer({
      feedbackProtocol: "legacy", timerRemainingMilliseconds: seconds * 1_000 + 750,
    }))).mockReturnValue(new Promise(() => {}));
    await renderReady(value);
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    const choice = screen.getByRole("button", { name: /question-2-two/ });
    fireEvent.click(choice);
    await waitForAnswerSelection(549);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(choice).toHaveAttribute("data-feedback", "selected");
    await waitForAnswerSelection(1);
    await waitForAnswerSelection(1);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:" + String(seconds).padStart(2, "0"));
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("submits one automatic timeout then shows its delayed judgement for 200ms", async () => {
    const value = attempt(); value.questionTimeLimitSeconds = 5;
    let finish!: (value: unknown) => void;
    mocks.submit.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    mocks.resume.mockImplementation(async input => successfulTransport({
      questionDeadlineAt: "2099-01-01T00:00:05.200Z", questionStartsAt: "2099-01-01T00:00:00.200Z",
      timerRemainingMilliseconds: 5_000 + input.transitionRemainingMilliseconds,
      transitionRemainingMilliseconds: input.transitionRemainingMilliseconds,
    }));
    await renderReady(value, 1_000); await waitForAnswerSelection(1_002);
    await waitForAnswerSelection(1);
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ choiceIndex: null }));
    await waitForAnswerSelection(1_500);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("quiz-timeout-overlay")).toBeInTheDocument();
    await act(async () => { finish(successfulTransport(nextAnswer({ correct: false, timedOut: true }))); });
    await waitForAnswerSelection(199);
    expect(screen.getByTestId("quiz-timeout-overlay")).toBeInTheDocument();
    await waitForAnswerSelection(1);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("quiz-timeout-overlay")).toBeNull();
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:05");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it.each(["total", "none"] as const)("preserves a finite %s deadline through normal 200ms feedback", async timingMode => {
    const value = attempt(); value.timingMode = timingMode; value.questionTimeLimitSeconds = null;
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer({
      timerRemainingMilliseconds: timingMode === "total" ? 8_500 : 1_500,
    })));
    mocks.resume.mockImplementation(async input => successfulTransport({
      questionDeadlineAt: value.timerDeadlineAt, questionStartsAt: "2099-01-01T00:00:00.200Z",
      timerRemainingMilliseconds: 1_500, transitionRemainingMilliseconds: input.transitionRemainingMilliseconds,
    }));
    mocks.expire.mockResolvedValue({ ok: true });
    await renderReady(value);
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(mocks.expire).not.toHaveBeenCalled();
    await waitForAnswerSelection(1_302);
    await waitForAnswerSelection(1);
    expect(mocks.expire).toHaveBeenCalledTimes(1);
    await waitForAnswerSelection(10_000);
    expect(mocks.expire).toHaveBeenCalledTimes(1);
  });

  it("does not expire a truly untimed quiz after normal feedback", async () => {
    const value = attempt(); value.timingMode = "none"; value.questionTimeLimitSeconds = null;
    value.deadlineAt = value.timerDeadlineAt = "infinity";
    mocks.submit.mockImplementation(async () => successfulTransport(nextAnswer({ questionDeadlineAt: "infinity", timerRemainingMilliseconds: 0 })));
    mocks.resume.mockImplementation(async input => successfulTransport({
      questionDeadlineAt: "infinity", questionStartsAt: "2099-01-01T00:00:00.200Z",
      timerRemainingMilliseconds: 0, transitionRemainingMilliseconds: input.transitionRemainingMilliseconds,
    }));
    await renderReady(value, 0);
    fireEvent.click(screen.getByRole("button", { name: /^1\s*question-1-one/ }));
    await waitForAnswerSelection(); await waitForAnswerSelection(200);
    await waitForAnswerSelection(60_000);
    expect(screen.getByText("question-2-prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /question-2-one/ })).toBeEnabled();
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it("shows a saved last initial wrong answer before entering review after a lost response", async () => {
    const value = attempt(), restored = savedAttempt(value, false, true);
    restored.phase = "review"; restored.status = "in_progress";
    mocks.submit.mockRejectedValue(new Error("lost"));
    await renderReady(value);
    mocks.recover.mockImplementation(async () => successfulTransport({ attempt: restored, timerRemainingMilliseconds: 0 }));
    const selected = screen.getByRole("button", { name: /^1\s*question-1-one/ });
    fireEvent.click(selected); await waitForAnswerSelection();
    expect(selected).toHaveAttribute("data-feedback", "wrong");
    await waitForAnswerSelection(199); expect(mocks.replace).not.toHaveBeenCalled();
    await waitForAnswerSelection(1);
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/student/result/attempt-1");
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
      name: /^1\s*question-1-one/,
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

  it("locks at the conservative zero but waits for the server deadline before timing out", async () => {
    let resolveRecovery: (value: unknown) => void = () => {};
    const quizAttempt = attempt();
    mocks.recover.mockReturnValue(
      new Promise((resolve) => {
        resolveRecovery = resolve;
      }),
    );
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

    render(
      <QuizPlayer
        initialAttempt={quizAttempt}
        initialRemainingMilliseconds={60_000}
      />,
    );
    act(() => vi.advanceTimersByTime(400));
    await act(async () => {
      resolveRecovery({
        ok: true,
        payload: {
          attempt: quizAttempt,
          timerRemainingMilliseconds: 1_000,
        },
        receivedAt: performance.now(),
        roundTripMilliseconds: 400,
      });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(601);
      await Promise.resolve();
    });
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:00");
    expect(
      screen.getByRole("button", { name: /^1\s*question-1-one/ }),
    ).toBeDisabled();
    expect(mocks.submit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(399));
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ choiceIndex: null }),
    );
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
      name: /^1\s*question-1-one/,
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

function nextAnswer(overrides: Partial<QuizAnswerResponse> = {}): QuizAnswerResponse {
  return {
    correct: true, correctChoiceIndex: overrides.correct === false ? 1 : 0,
    nextPhase: "initial", nextQuestionId: "question-2", feedbackProtocol: "variable",
    questionDeadlineAt: "2099-01-01T00:00:17.000Z", timerRemainingMilliseconds: 17_000,
    ...overrides,
  };
}
function savedAttempt(value: QuizAttempt, correct: boolean, terminal = false): QuizAttempt {
  const restored = structuredClone(value);
  const q = restored.questions[0];
  if (value.phase === "retry") { q.retryChoiceIndex = 0; q.retryIsCorrect = correct; }
  else { q.initialChoiceIndex = 0; q.initialIsCorrect = correct; }
  q.revealedCorrectChoiceIndex = correct ? 0 : 1;
  restored.currentQuestionId = terminal ? null : "question-2";
  if (terminal) { restored.phase = "completed"; restored.status = "completed"; }
  return restored;
}
