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
  timeoutMilliseconds: number,
): QuizAudioCompletionRun {
  let interrupt = () => {};
  const result = new Promise<QuizAudioCompletion>((resolve) => {
    let settled = false;
    let timeout: number | null = null;
    const finish = (outcome: QuizAudioCompletion) => {
      if (settled) return;
      settled = true;
      player.removeEventListener("ended", handleEnded);
      player.removeEventListener("error", handleError);
      if (timeout !== null) window.clearTimeout(timeout);
      resolve(outcome);
    };
    const handleEnded = () => finish("ended");
    const handleError = () => finish("failed");
    interrupt = () => finish("interrupted");

    player.addEventListener("ended", handleEnded);
    player.addEventListener("error", handleError);
    timeout = window.setTimeout(
      () => finish("timed-out"),
      timeoutMilliseconds,
    );
    void player.play().catch((error) =>
      finish(audioPlaybackFailure(error)),
    );
  });
  return { interrupt, result };
}
