export type QuizAudioPurpose = "choice" | "prompt";
export type QuizAudioPlayback =
  | "blocked"
  | "failed"
  | "interrupted"
  | "started";

export type QuizAudioCompletion =
  | QuizAudioPlayback
  | "ended"
  | "timed-out";

export function audioPlaybackFailure(error: unknown): QuizAudioPlayback {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
    ? "blocked"
    : "failed";
}

export function seekAudioToStart(player: HTMLAudioElement) {
  try {
    player.currentTime = 0;
  } catch {
    // Some mobile engines reject seeking before metadata is available.
  }
}

export function primeAudioElement(
  player: HTMLAudioElement,
  isCurrent: () => boolean,
) {
  player.muted = true;
  void player.play().then(
    () => {
      if (!isCurrent()) return;
      player.pause();
      seekAudioToStart(player);
    },
    () => {
      // A later explicit speaker click remains available if priming is blocked.
    },
  );
}

export function releaseAudioElement(player: HTMLAudioElement) {
  player.pause();
  player.removeAttribute("src");
  player.load();
}
