import { releaseAudioElement } from "./quiz-audio-element";

export class QuizAudioPreloaders {
  private readonly elements = new Map<string, HTMLAudioElement>();

  sync(audioUrls: readonly string[]) {
    const nextUrls = new Set(audioUrls);
    for (const audioUrl of nextUrls) {
      if (this.elements.has(audioUrl)) continue;
      const preloader = new Audio();
      preloader.preload = "auto";
      preloader.src = audioUrl;
      preloader.load();
      this.elements.set(audioUrl, preloader);
    }
    for (const [audioUrl, preloader] of this.elements) {
      if (nextUrls.has(audioUrl)) continue;
      releaseAudioElement(preloader);
      this.elements.delete(audioUrl);
    }
  }

  dispose() {
    for (const preloader of this.elements.values()) {
      releaseAudioElement(preloader);
    }
    this.elements.clear();
  }
}
