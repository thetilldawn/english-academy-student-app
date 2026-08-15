// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForQuizAudioCompletion } from "./quiz-audio-completion";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("waitForQuizAudioCompletion", () => {
  it("starts the playback watchdog after delayed audio begins", async () => {
    vi.useFakeTimers();
    const player = document.createElement("audio");
    let startPlayback = () => {};
    vi.spyOn(player, "play").mockReturnValue(
      new Promise<void>((resolve) => {
        startPlayback = resolve;
      }),
    );
    const completion = waitForQuizAudioCompletion(player, 3_000, 1_000);
    let outcome: string | null = null;
    void completion.result.then((result) => {
      outcome = result;
    });

    await vi.advanceTimersByTimeAsync(700);
    player.dispatchEvent(new Event("playing"));
    startPlayback();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_376);

    expect(outcome).toBeNull();
    player.dispatchEvent(new Event("ended"));
    await expect(completion.result).resolves.toBe("ended");
  });

  it("still stops playback that never starts", async () => {
    vi.useFakeTimers();
    const player = document.createElement("audio");
    vi.spyOn(player, "play").mockReturnValue(new Promise(() => {}));
    const completion = waitForQuizAudioCompletion(player, 3_000, 1_000);

    vi.advanceTimersByTime(1_000);
    await expect(completion.result).resolves.toBe("timed-out");
  });
});
