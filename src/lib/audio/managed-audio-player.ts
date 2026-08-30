export type ManagedAudioPlayback =
  | "blocked"
  | "failed"
  | "interrupted"
  | "started";

export class ManagedAudioPlayer {
  private generation = 0;
  private player: HTMLAudioElement | null = null;
  private playerUrl: string | null = null;

  async play(audioUrl: string): Promise<ManagedAudioPlayback> {
    const generation = ++this.generation;
    const player = this.prepare(audioUrl);

    try {
      await player.play();
      return generation === this.generation ? "started" : "interrupted";
    } catch (error) {
      if (generation !== this.generation) return "interrupted";
      return typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "NotAllowedError"
        ? "blocked"
        : "failed";
    }
  }

  dispose() {
    this.generation += 1;
    if (this.player) {
      this.player.pause();
      this.player.removeAttribute("src");
      this.player.load();
    }
    this.player = null;
    this.playerUrl = null;
  }

  private prepare(audioUrl: string) {
    this.player ??= new Audio();
    this.player.pause();
    this.player.preload = "auto";
    if (this.playerUrl !== audioUrl) {
      this.player.src = audioUrl;
      this.player.load();
      this.playerUrl = audioUrl;
    }
    try {
      this.player.currentTime = 0;
    } catch {
      // Some mobile engines reject seeking before metadata is available.
    }
    return this.player;
  }
}
