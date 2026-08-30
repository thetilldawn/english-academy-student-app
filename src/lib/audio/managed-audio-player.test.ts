import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagedAudioPlayer } from "./managed-audio-player";

class FakeAudio {
  currentTime = 12;
  preload = "";
  src = "";
  load = vi.fn();
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  removeAttribute = vi.fn();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ManagedAudioPlayer", () => {
  it("reuses one element, restarts playback, and releases it", async () => {
    const audio = new FakeAudio();
    const AudioConstructor = vi.fn(function AudioConstructor() {
      return audio;
    });
    vi.stubGlobal("Audio", AudioConstructor);
    const player = new ManagedAudioPlayer();

    await expect(player.play("/one.mp3")).resolves.toBe("started");
    await expect(player.play("/one.mp3")).resolves.toBe("started");
    expect(AudioConstructor).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(2);

    player.dispose();
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalledTimes(2);
  });
});
