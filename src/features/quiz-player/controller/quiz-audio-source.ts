import {
  releaseAudioElement,
  seekAudioToStart,
} from "./quiz-audio-element";

export class QuizAudioSource {
  private player: HTMLAudioElement | null = null;
  private playerUrl: string | null = null;

  prepare(audioUrl: string, restart = true) {
    this.player ??= new Audio();
    this.player.preload = "auto";
    if (restart || this.playerUrl !== audioUrl) this.player.pause();
    if (this.playerUrl !== audioUrl) {
      this.player.src = audioUrl;
      this.player.load();
      this.playerUrl = audioUrl;
    }
    if (restart) {
      seekAudioToStart(this.player);
    }
    return this.player;
  }

  pause() {
    this.player?.pause();
  }

  dispose() {
    if (this.player) releaseAudioElement(this.player);
    this.player = null;
    this.playerUrl = null;
  }
}
