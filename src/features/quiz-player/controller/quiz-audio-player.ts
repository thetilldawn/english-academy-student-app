import {
  audioPlaybackFailure,
  primeAudioElement,
  type QuizAudioPurpose,
} from "./quiz-audio-element";
import { waitForQuizAudioCompletion } from "./quiz-audio-completion";
import { QuizAudioPreloaders } from "./quiz-audio-preloaders";
import { QuizAudioSource } from "./quiz-audio-source";

export class QuizAudioPlayer {
  private activePurpose: QuizAudioPurpose | null = null;
  private generation = 0;
  private interruptCompletion: (() => void) | null = null;
  private readonly preloaders = new QuizAudioPreloaders();
  private readonly source = new QuizAudioSource();

  preparePrompt(audioUrl: string) {
    this.source.prepare(audioUrl, false);
  }

  preloadChoices(audioUrls: readonly string[]) {
    this.preloaders.sync(audioUrls);
  }

  primeChoice(audioUrl: string) {
    this.interruptActiveCompletion();
    const generation = ++this.generation;
    const player = this.source.prepare(audioUrl);
    this.activePurpose = null;
    primeAudioElement(player, () => generation === this.generation);
  }

  async play(audioUrl: string, purpose: QuizAudioPurpose) {
    this.interruptActiveCompletion();
    const generation = ++this.generation;
    const player = this.source.prepare(audioUrl);
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

  async playUntilEnded(
    audioUrl: string,
    purpose: QuizAudioPurpose,
    playbackTimeoutMilliseconds: number,
    startupTimeoutMilliseconds: number,
  ) {
    this.interruptActiveCompletion();
    const generation = ++this.generation;
    const player = this.source.prepare(audioUrl);
    player.muted = false;
    this.activePurpose = purpose;

    const completion = waitForQuizAudioCompletion(
      player,
      playbackTimeoutMilliseconds,
      startupTimeoutMilliseconds,
    );
    this.interruptCompletion = completion.interrupt;
    const result = await completion.result;
    if (this.interruptCompletion === completion.interrupt) {
      this.interruptCompletion = null;
    }
    if (generation !== this.generation) return "interrupted";
    if (["failed", "blocked", "timed-out"].includes(result)) {
      player.pause();
      this.activePurpose = null;
    }
    return result;
  }

  stopPrompt() {
    if (this.activePurpose !== "prompt") return;
    this.interruptActiveCompletion();
    this.source.pause();
    this.activePurpose = null;
    this.generation += 1;
  }

  dispose() {
    this.interruptActiveCompletion();
    this.source.dispose();
    this.preloaders.dispose();
    this.activePurpose = null;
    this.generation += 1;
  }

  private interruptActiveCompletion() {
    const interrupt = this.interruptCompletion;
    this.interruptCompletion = null;
    interrupt?.();
  }

}
