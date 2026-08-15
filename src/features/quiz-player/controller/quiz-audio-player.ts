import {
  audioPlaybackFailure,
  primeAudioElement,
  releaseAudioElement,
  seekAudioToStart,
  type QuizAudioPurpose,
} from "./quiz-audio-element";

export class QuizAudioPlayer {
  private activePurpose: QuizAudioPurpose | null = null;
  private generation = 0;
  private player: HTMLAudioElement | null = null;
  private playerUrl: string | null = null;
  private readonly preloaders = new Map<string, HTMLAudioElement>();

  private getPlayer() {
    this.player ??= new Audio();
    this.player.preload = "auto";
    return this.player;
  }

  preparePrompt(audioUrl: string) {
    const player = this.getPlayer();
    if (this.playerUrl === audioUrl) return;
    player.pause();
    player.src = audioUrl;
    player.load();
    this.playerUrl = audioUrl;
  }

  preloadChoices(audioUrls: readonly string[]) {
    const nextUrls = new Set(audioUrls);
    for (const audioUrl of nextUrls) {
      if (this.preloaders.has(audioUrl)) continue;
      const preloader = new Audio();
      preloader.preload = "auto";
      preloader.src = audioUrl;
      preloader.load();
      this.preloaders.set(audioUrl, preloader);
    }
    for (const [audioUrl, preloader] of this.preloaders) {
      if (nextUrls.has(audioUrl)) continue;
      preloader.pause();
      preloader.removeAttribute("src");
      preloader.load();
      this.preloaders.delete(audioUrl);
    }
  }

  primeChoice(audioUrl: string) {
    const generation = ++this.generation;
    const player = this.getPlayer();
    player.pause();
    if (this.playerUrl !== audioUrl) {
      player.src = audioUrl;
      player.load();
      this.playerUrl = audioUrl;
    }
    seekAudioToStart(player);
    this.activePurpose = null;
    primeAudioElement(player, () => generation === this.generation);
  }

  async play(audioUrl: string, purpose: QuizAudioPurpose) {
    const generation = ++this.generation;
    const player = this.getPlayer();
    player.pause();
    seekAudioToStart(player);
    if (this.playerUrl !== audioUrl) {
      player.src = audioUrl;
      player.load();
      this.playerUrl = audioUrl;
    }
    player.muted = false;
    this.activePurpose = purpose;
    try {
      await player.play();
      return generation === this.generation ? "started" : "interrupted";
    } catch (error) {
      return generation === this.generation
        ? audioPlaybackFailure(error)
        : "interrupted";
    }
  }

  stopPrompt() {
    if (this.activePurpose !== "prompt") return;
    this.player?.pause();
    this.activePurpose = null;
    this.generation += 1;
  }

  dispose() {
    if (this.player) releaseAudioElement(this.player);
    for (const preloader of this.preloaders.values())
      releaseAudioElement(preloader);
    this.preloaders.clear();
    this.player = null;
    this.playerUrl = null;
    this.activePurpose = null;
    this.generation += 1;
  }
}
