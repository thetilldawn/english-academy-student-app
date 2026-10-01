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
  // Read-only visual evidence for the local fake exam. Never loaded in deployment.
  let previousFrame;
  let nodeSequence=0;
  const nodes=new WeakMap();
  const nodeId=node=>{if(!node)return null;if(!nodes.has(node))nodes.set(node,++nodeSequence);return nodes.get(node);};
  window.addEventListener('error',event=>console.info('[local-quiz-js-error]',Date.now(),event.message));
  window.addEventListener('unhandledrejection',event=>console.info('[local-quiz-js-error]',Date.now(),String(event.reason)));
  if(typeof PerformanceObserver!=='undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    new PerformanceObserver(list=>{for(const item of list.getEntries()) console.info('[local-quiz-longtask]',Date.now(),Math.round(item.duration));}).observe({type:'longtask',buffered:true});
  }
  const observeFrame = () => {
    const promptNode=document.querySelector('#quiz-prompt');
    const timerNode=document.querySelector('[data-testid="quiz-timer"]');
    const prompt = promptNode?.textContent ?? null;
    const statuses = Array.from(document.querySelectorAll('[role="status"]')).map(node => node.textContent);
    const state = JSON.stringify({ prompt, preparing: statuses.some(text => text?.includes('다음 문제 준비 중')),
      initial: statuses.some(text => text?.includes('시험 준비 중')),
      statuses, errors:Array.from(document.querySelectorAll('[role="alert"]')).map(node=>node.textContent),
      promptNode:nodeId(promptNode),timerNode:nodeId(timerNode),timer:timerNode?.textContent??null,
      choices:Array.from(document.querySelectorAll('[data-feedback]')).map(node=>({state:node.dataset.feedback,disabled:node.disabled})),
      path:location.pathname });
    if (state === previousFrame) return;
    previousFrame = state;
    console.info('[local-quiz-frame]', Date.now(), state);
  };
  new MutationObserver(observeFrame).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  observeFrame();
})();
