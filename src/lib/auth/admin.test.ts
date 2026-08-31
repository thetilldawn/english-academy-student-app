import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  getClaims: vi.fn(),
  getCurrentRequestContext: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("react", () => ({ cache: (value: unknown) => value }));
vi.mock("@/lib/observability/server-request-context", () => ({
  getCurrentRequestContext: mocks.getCurrentRequestContext,
}));
vi.mock("@/lib/observability/request-timing", () => ({
  logServerOperationTiming: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { getAdminContext, getAdminContextOrThrow } from "./admin";

function profileBuilder() {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: mocks.maybeSingle }),
    }),
  };
}

describe("admin authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentRequestContext.mockResolvedValue({
      absoluteDeadlineAt: null,
      requestId: "request-1",
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getClaims: mocks.getClaims },
      from: () => profileBuilder(),
    });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "admin-id" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { display_name: "관리자", is_active: true },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("유효하지 않은 세션과 비활성 관리자는 로그인되지 않은 상태로 처리한다", async () => {
    mocks.getClaims.mockResolvedValueOnce({
      data: null,
      error: new Error("invalid jwt"),
    });
    await expect(getAdminContext()).resolves.toBeNull();

    mocks.maybeSingle.mockResolvedValueOnce({
      data: { display_name: "관리자", is_active: false },
      error: null,
    });
    await expect(getAdminContext()).resolves.toBeNull();
  });

  it("인증 요청 제한 시간은 잘못된 로그인으로 위장하지 않는다", async () => {
    vi.useFakeTimers();
    mocks.getClaims.mockImplementationOnce(() => {
      const signal = mocks.createServerSupabaseClient.mock.calls[0]?.[0]
        ?.signal as AbortSignal;
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({
          data: null,
          error: new Error("aborted"),
        }), { once: true });
      });
    });

    const result = getAdminContextOrThrow();
    const expectation = expect(result).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
      name: "AdminAuthenticationUnavailableError",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expectation;
  });

  it("기존 관리자 API는 일시 오류를 미처리 500으로 바꾸지 않는다", async () => {
    mocks.getClaims.mockRejectedValueOnce(new Error("network unavailable"));

    await expect(getAdminContext()).resolves.toBeNull();
  });
});
