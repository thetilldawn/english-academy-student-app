import {
  audioPlaybackFailure,
  type QuizAudioCompletion,
} from "./quiz-audio-element";

type QuizAudioCompletionRun = {
  interrupt: () => void;
  result: Promise<QuizAudioCompletion>;
};

export function waitForQuizAudioCompletion(
  player: HTMLAudioElement,
  playbackTimeoutMilliseconds: number,
  startupTimeoutMilliseconds: number,
): QuizAudioCompletionRun {
  let interrupt = () => {};
  const result = new Promise<QuizAudioCompletion>((resolve) => {
    let settled = false;
    let timeout: number | null = null;
    let playbackWatchdogStarted = false;
    const startPlaybackWatchdog = () => {
      if (settled || playbackWatchdogStarted) return;
      playbackWatchdogStarted = true;
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(
        () => finish("timed-out"),
        playbackTimeoutMilliseconds,
      );
    };
    const finish = (outcome: QuizAudioCompletion) => {
      if (settled) return;
      settled = true;
      player.removeEventListener("ended", handleEnded);
      player.removeEventListener("error", handleError);
      player.removeEventListener("playing", startPlaybackWatchdog);
      if (timeout !== null) window.clearTimeout(timeout);
      resolve(outcome);
    };
    const handleEnded = () => finish("ended");
    const handleError = () => finish("failed");
    interrupt = () => finish("interrupted");

    player.addEventListener("ended", handleEnded);
    player.addEventListener("error", handleError);
    player.addEventListener("playing", startPlaybackWatchdog);
    timeout = window.setTimeout(
      () => finish("timed-out"),
      startupTimeoutMilliseconds,
    );
    void player.play().then(startPlaybackWatchdog).catch((error) =>
        finish(audioPlaybackFailure(error)),
      );
  });
  return { interrupt, result };
}
