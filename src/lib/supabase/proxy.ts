import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnvironment, hasSupabaseEnvironment } from "@/lib/env";
import {
  ADMIN_AUTH_REQUEST_DEADLINE_MS,
  ADMIN_INTERACTIVE_REQUEST_BUDGET_MS,
  createDeadlineFetch,
  createRequestDeadline,
} from "@/lib/network/request-policy";
import {
  APP_REQUEST_DEADLINE_HEADER,
  APP_REQUEST_ID_HEADER,
  appendServerTiming,
  createRequestId,
  formatServerTiming,
  logServerOperationTiming,
} from "@/lib/observability/request-timing";
import { adminAuthCookieOptions } from "@/lib/supabase/cookie-options";

export async function refreshAdminSession(request: NextRequest) {
  const requestId = createRequestId(request.headers);
  const absoluteDeadlineAt =
    Date.now() + ADMIN_INTERACTIVE_REQUEST_BUDGET_MS;
  let forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(APP_REQUEST_ID_HEADER, requestId);
  forwardedHeaders.set(
    APP_REQUEST_DEADLINE_HEADER,
    String(absoluteDeadlineAt),
  );
  let response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });

  if (!hasSupabaseEnvironment()) {
    response.headers.set(APP_REQUEST_ID_HEADER, requestId);
    return response;
  }

  const startedAt = performance.now();
  const deadline = createRequestDeadline(
    ADMIN_AUTH_REQUEST_DEADLINE_MS,
    request.signal,
  );
  let outcome: "cancelled" | "error" | "success" | "timeout" = "success";
  const environment = getPublicEnvironment();
  const supabase = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: createDeadlineFetch(deadline.signal) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, responseHeaders) {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
          }

          forwardedHeaders = new Headers(request.headers);
          forwardedHeaders.set(APP_REQUEST_ID_HEADER, requestId);
          forwardedHeaders.set(
            APP_REQUEST_DEADLINE_HEADER,
            String(absoluteDeadlineAt),
          );
          response = NextResponse.next({
            request: { headers: forwardedHeaders },
          });
          for (const cookie of cookiesToSet) {
            response.cookies.set(cookie.name, cookie.value, {
              ...cookie.options,
              ...adminAuthCookieOptions(),
            });
          }
          for (const [name, value] of Object.entries(responseHeaders)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  try {
    await supabase.auth.getClaims();
    if (deadline.expired) outcome = "timeout";
    else if (request.signal.aborted) outcome = "cancelled";
  } catch {
    outcome = deadline.expired
      ? "timeout"
      : request.signal.aborted
        ? "cancelled"
        : "error";
    // Proxy는 세션 갱신만 담당한다. 실제 관리자 권한은 서버 DAL에서 다시 확인한다.
  } finally {
    deadline.dispose();
  }

  const durationMs = performance.now() - startedAt;
  response.headers.set(APP_REQUEST_ID_HEADER, requestId);
  appendServerTiming(
    response.headers,
    formatServerTiming("admin_proxy_auth", durationMs),
  );
  logServerOperationTiming({
    durationMs,
    operation: "admin.proxy.auth_refresh",
    outcome,
    requestId,
  });
  return response;
}
