/** Only the public offline screen is in the worker's scope. */
export async function prepareLocalQuizScreen(detached = false) {
  if (!('serviceWorker' in navigator)) throw new Error('local_offline_screen_unavailable');
  let disposed = false; let listener: (() => void) | null = null; let channel: MessageChannel | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopInstalling: (() => void) | undefined;
  const isReady = (worker: ServiceWorker, repair = false) => new Promise<boolean>(resolve => {
    const prior = channel as MessageChannel | null; prior?.port1.close(); prior?.port2.close();
    channel = new MessageChannel();
    channel.port1.onmessage = event => resolve(event.data?.ready === true);
    worker.postMessage({ type: repair ? 'LOCAL_QUIZ_REPAIR' : 'LOCAL_QUIZ_READY' }, [channel.port2]);
  });
  try {
    await Promise.race([
      (async () => {
        const registration = await navigator.serviceWorker.register('/quiz-offline-sw.js', { scope: '/quiz-offline', updateViaCache: 'none' });
        if (disposed) return;
        // An update may decline installation because another test is playing.
        // The complete active build remains usable for this attempt.
        if (registration.active && (detached || navigator.serviceWorker.controller === registration.active) && await isReady(registration.active)) return;
        // Finish a currently installing update before starting any clock.
        const installing = registration.installing;
        if (installing) await new Promise<void>((resolve, reject) => {
          const changed = () => {
            if (["installed", "activated", "redundant"].includes(installing.state)) {
              installing.removeEventListener("statechange", changed);
              if (installing.state === "redundant" && !registration.active) reject(new Error('local_offline_screen_unavailable'));
              else resolve();
            }
          };
          stopInstalling = () => installing.removeEventListener("statechange", changed);
          installing.addEventListener("statechange", changed); changed();
        });
        if (detached) {
          const worker = registration.active ?? registration.waiting ?? installing;
          if (!worker) throw new Error('local_offline_screen_unavailable');
          if (!await isReady(worker) && !await isReady(worker, true)) throw new Error('local_offline_screen_incomplete');
          return;
        }
        await navigator.serviceWorker.ready;
        if (disposed) return;
        if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
          listener = () => resolve(); navigator.serviceWorker.addEventListener('controllerchange', listener, { once: true });
        });
        if (disposed) return;
        if (!await isReady(navigator.serviceWorker.controller!) && !await isReady(navigator.serviceWorker.controller!, true)) throw new Error('local_offline_screen_incomplete');
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('local_offline_screen_unavailable')), 30_000); }),
    ]);
  } finally {
    disposed = true; clearTimeout(timer);
    stopInstalling?.();
    if (listener) navigator.serviceWorker.removeEventListener('controllerchange', listener);
    // Closure assignment is asynchronous; the ports still belong to this call.
    const ports = channel as MessageChannel | null; ports?.port1.close(); ports?.port2.close();
  }
}

/** While a test is open, automatic worker updates cannot download screen assets. */
export async function holdLocalQuizScreen(signal: AbortSignal) {
  if (!navigator.locks) throw new Error('local_tab_lock_unavailable');
  return new Promise<() => void>((resolve, reject) => {
    navigator.locks.request('quiz-offline-assets-v1', { mode: 'shared', signal }, () =>
      new Promise<void>(release => resolve(release))).catch(reject);
  });
}
