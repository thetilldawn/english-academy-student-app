import { AuthRetryableFetchError } from "@supabase/supabase-js";

import { createDeadlineFetch } from "@/lib/network/request-policy";

/** Rate limiting and transport timeouts must not revoke an otherwise valid session. */
export function createAuthSafeFetch(
  supabaseUrl: string,
  signal?: AbortSignal,
  implementation: typeof fetch = globalThis.fetch,
): typeof fetch {
  const authOrigin = new URL(supabaseUrl).origin;
  const bounded = signal ? createDeadlineFetch(signal, implementation) : implementation;
  return async (input, init) => {
    const response = await bounded(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === authOrigin && url.pathname.startsWith("/auth/v1/") && (response.status === 408 || response.status === 429 || response.status >= 500)) {
      void response.body?.cancel().catch(() => undefined);
      throw new AuthRetryableFetchError("Authentication service temporarily unavailable.", response.status);
    }
    return response;
  };
}
