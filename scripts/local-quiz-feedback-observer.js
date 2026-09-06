// Injected only by the explicitly enabled, isolated localhost QA server.
(() => {
  if (location.origin !== "http://127.0.0.1:3037") return;
  const NativeAudio = window.Audio;
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  const fixture = "https://media.merriam-webster.com/audio/prons/en/us/mp3/l/localfixture.mp3";
  let sequence = 0;
  function ObservedAudio(url) {
    const audio = new NativeAudio(), id = ++sequence;
    Object.defineProperty(audio, "src", { configurable: true,
      get() { return src.get.call(this); },
      set(value) { src.set.call(this, value === fixture ? "/__baseline/quiz-audio.wav" : value); },
    });
    for (const kind of ["playing", "pause", "ended", "error"]) audio.addEventListener(kind, () => {
      void fetch("/__baseline/quiz-observe", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, at: Date.now(), currentTime: audio.currentTime, paused: audio.paused, muted: audio.muted }),
      }).catch(() => {});
    });
    if (url !== undefined) audio.src = url;
    return audio;
  }
  ObservedAudio.prototype = NativeAudio.prototype;
  window.Audio = ObservedAudio;
})();
