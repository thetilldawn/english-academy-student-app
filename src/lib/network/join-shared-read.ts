export type SharedRead<Value> = {
  abort: AbortController;
  promise: Promise<Value>;
  consumers: object[];
};

/** Cancelling one reader must not cancel a request still used by another. */
export function joinSharedRead<Value>(request: SharedRead<Value>, signal?: AbortSignal) {
  return new Promise<Value>((resolve, reject) => {
    const consumer = {};
    request.consumers.push(consumer);
    const detach = () => {
      signal?.removeEventListener("abort", onAbort);
      const index = request.consumers.indexOf(consumer);
      if (index >= 0) request.consumers.splice(index, 1);
    };
    const onAbort = () => {
      detach(); reject(new DOMException("Request cancelled", "AbortError"));
      if (!request.consumers.length) request.abort.abort();
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    request.promise.then(value => { if (!signal?.aborted) resolve(value); }, error => { if (!signal?.aborted) reject(error); }).finally(detach);
  });
}
