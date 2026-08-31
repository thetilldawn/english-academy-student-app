export const ADMIN_AUTH_REQUEST_DEADLINE_MS = 5_000;
export const ADMIN_INTERACTIVE_REQUEST_BUDGET_MS = 7_000;
export const INTERACTIVE_READ_REQUEST_DEADLINE_MS = 7_000;

export type RequestDeadline = {
  readonly signal: AbortSignal;
  readonly expired: boolean;
  dispose: () => void;
};

type LinkedAbortSignal = {
  signal: AbortSignal;
  dispose: () => void;
};

function linkAbortSignals(
  candidates: ReadonlyArray<AbortSignal | null | undefined>,
): LinkedAbortSignal {
  const signals = candidates.filter(
    (candidate): candidate is AbortSignal => Boolean(candidate),
  );

  if (signals.length === 0) {
    return {
      signal: new AbortController().signal,
      dispose() {},
    };
  }
  if (signals.length === 1) {
    return {
      signal: signals[0]!,
      dispose() {},
    };
  }

  return {
    // Native composition stays connected after fetch headers arrive, so an
    // abort can still cancel a response body that Supabase is parsing.
    signal: AbortSignal.any(signals),
    dispose() {},
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

export function awaitWithAbortSignal<T>(
  operation: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => settle(() => reject(abortReason(signal)));

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

export function createRequestDeadline(
  timeoutMs: number,
  parentSignal?: AbortSignal | null,
): RequestDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("요청 제한 시간은 0보다 큰 숫자여야 합니다.");
  }

  const controller = new AbortController();
  let expired = false;
  let disposed = false;

  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    if (disposed || controller.signal.aborted) return;
    expired = true;
    // Supabase가 표준 AbortError로 인식하도록 사용자 정의 reason은 넣지 않는다.
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    get expired() {
      return expired;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

export function requestTimeoutWithinBudget(
  maximumMs: number,
  absoluteDeadlineAt?: number | null,
  now = Date.now(),
): number {
  if (!Number.isFinite(maximumMs) || maximumMs <= 0) {
    throw new RangeError("요청 제한 시간은 0보다 큰 숫자여야 합니다.");
  }
  if (
    typeof absoluteDeadlineAt !== "number" ||
    !Number.isFinite(absoluteDeadlineAt)
  ) {
    return maximumMs;
  }
  return Math.max(1, Math.min(maximumMs, absoluteDeadlineAt - now));
}

export function createDeadlineFetch(
  deadlineSignal: AbortSignal,
  implementation: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const requestSignal =
      typeof Request !== "undefined" && input instanceof Request
        ? input.signal
        : undefined;
    const linked = linkAbortSignals([
      deadlineSignal,
      requestSignal,
      init?.signal,
    ]);

    try {
      return await implementation(input, {
        ...(init ?? {}),
        signal: linked.signal,
      });
    } catch (error) {
      if (!deadlineSignal.aborted) throw error;

      // Supabase Auth treats a thrown AbortError as retryable and may keep the
      // outer getClaims() promise alive. A bounded 408 response stops that
      // background retry while the caller's deadline wrapper exits at once.
      return Response.json(
        { code: "request_timeout", message: "Request timed out." },
        { status: 408, statusText: "Request Timeout" },
      );
    } finally {
      linked.dispose();
    }
  };
}
