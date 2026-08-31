import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getPublicEnvironment: vi.fn(),
  hasSupabaseEnvironment: vi.fn(),
  logServerOperationTiming: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/env", () => ({
  getPublicEnvironment: mocks.getPublicEnvironment,
  hasSupabaseEnvironment: mocks.hasSupabaseEnvironment,
}));
vi.mock("@/lib/observability/request-timing", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/observability/request-timing")
  >();
  return {
    ...original,
    logServerOperationTiming: mocks.logServerOperationTiming,
  };
});

import { refreshAdminSession } from "./proxy";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

type MockServerClientOptions = {
  cookies: {
    setAll: (
      cookies: CookieToSet[],
      responseHeaders: Record<string, string>,
    ) => void;
  };
  global: { fetch: typeof fetch };
};

function request() {
  return new NextRequest("https://study.example.com/admin/results", {
    headers: { "x-vercel-id": "icn1::r9-test" },
  });
}

describe("admin session proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSupabaseEnvironment.mockReturnValue(true);
    mocks.getPublicEnvironment.mockReturnValue({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("인증 갱신이 5초를 넘으면 요청 식별자를 남기고 다음 권한 검사로 넘긴다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise(
      (_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(
          new DOMException("aborted", "AbortError"),
        ), { once: true });
      },
    )));
    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: MockServerClientOptions) => ({
        auth: {
          getClaims: () => options.global.fetch(
            "https://supabase.example.test/auth/v1/user",
          ),
        },
      }),
    );

    const responsePromise = refreshAdminSession(request());
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await responsePromise;

    expect(response.headers.get("x-app-request-id")).toBe("icn1::r9-test");
    expect(response.headers.get("x-middleware-request-x-app-request-deadline-at"))
      .toMatch(/^\d+$/);
    expect(response.headers.get("server-timing")).toMatch(
      /^admin_proxy_auth;dur=/,
    );
    expect(mocks.logServerOperationTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "admin.proxy.auth_refresh",
        outcome: "timeout",
        requestId: "icn1::r9-test",
      }),
    );
  });

  it("Supabase가 갱신한 쿠키와 응답 헤더를 새 Proxy 응답에도 보존한다", async () => {
    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: MockServerClientOptions) => ({
        auth: {
          getClaims: async () => {
            options.cookies.setAll([
              {
                name: "sb-test-auth-token",
                value: "rotated",
                options: { path: "/" },
              },
            ], { "x-auth-refreshed": "1" });
            return { data: null, error: null };
          },
        },
      }),
    );

    const response = await refreshAdminSession(request());

    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("rotated");
    expect(response.headers.get("x-auth-refreshed")).toBe("1");
    expect(response.headers.get("x-app-request-id")).toBe("icn1::r9-test");
  });
});
