import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAdminHistoryReadError extends Error {
    constructor(
      message: string,
      readonly reason: "contract" | "database" | "input" | "timeout" = "database",
    ) {
      super(message);
    }
  }
  class MockAdminAuthenticationUnavailableError extends Error {
    readonly code = "UPSTREAM_TIMEOUT";

    constructor(message: string) {
      super(message);
      this.name = "AdminAuthenticationUnavailableError";
    }
  }

  return {
    AdminAuthenticationUnavailableError: MockAdminAuthenticationUnavailableError,
    AdminHistoryReadError: MockAdminHistoryReadError,
    getAdminContext: vi.fn(),
    listAdminHistoryFreshSection: vi.fn(),
    listAdminHistoryInitial: vi.fn(),
    listAdminHistoryNextPage: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
    AdminAuthenticationUnavailableError:
    mocks.AdminAuthenticationUnavailableError,
  getAdminContext: mocks.getAdminContext,
  getAdminContextOrThrow: mocks.getAdminContext,
}));
vi.mock("@/features/history/server/queries/admin-history-read-error", () => ({
  AdminHistoryReadError: mocks.AdminHistoryReadError,
}));
vi.mock("@/features/history/server/queries/admin-history-list-query", () => ({
  listAdminHistoryFreshSection: mocks.listAdminHistoryFreshSection,
  listAdminHistoryInitial: mocks.listAdminHistoryInitial,
  listAdminHistoryNextPage: mocks.listAdminHistoryNextPage,
}));

import { POST } from "./route";
import { AdminHistoryCursorError } from "@/features/history/server/admin-history-cursor";
import { privateListCacheIdentity } from "@/lib/auth/private-cache-identity";
import type { AdminContext } from "@/lib/auth/admin";

function request(body: unknown, origin?: string) {
  return new Request("http://localhost/api/admin/history", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    method: "POST",
  });
}

const snapshot = {
  currentOnly: false,
  query: "",
  sections: [],
  snapshotAt: "2026-08-29T00:00:00.000Z",
  statusFilter: "all",
};

describe("POST /api/admin/history", () => {
  it("캐시 복원도 현재 인증 뒤에만 허용하고 첫 목록 RPC는 생략한다", async () => {
    const admin = { userId: "00000000-0000-4000-8000-000000000999", sessionId: "current-session" } as AdminContext;
    const identity = privateListCacheIdentity(admin, "history-list-v1");
    mocks.getAdminContext.mockResolvedValue(admin);
    const input = { mode: "cache", filters: { currentOnly: false, query: "", statusFilter: "all" }, identity };
    const response = await POST(request(input));
    expect(await response.json()).toEqual({ kind: "resume", identity, userId: admin.userId });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getAdminContext).toHaveBeenCalledTimes(1); expect(mocks.listAdminHistoryInitial).not.toHaveBeenCalled();
    mocks.getAdminContext.mockResolvedValue(null);
    expect((await POST(request(input))).status).toBe(401); expect(mocks.listAdminHistoryInitial).not.toHaveBeenCalled();
  });
  it("캐시 세대가 없거나 달라도 서버 현재 인증으로 첫 목록을 직접 읽는다", async () => {
    const input = { mode: "cache", filters: { currentOnly: false, query: "", statusFilter: "all" }, identity: "a".repeat(64) };
    const response = await POST(request(input));
    expect(await response.json()).toMatchObject({ kind: "snapshot", identity: null, snapshot });
    expect(mocks.listAdminHistoryInitial).toHaveBeenCalledTimes(1);
    expect(mocks.listAdminHistoryInitial.mock.calls[0][0]).toEqual(input.filters);
    expect((await POST(request({...input, filters:{...input.filters,currentOnly:true}}))).status).toBe(400);
    expect((await POST(request({...input, identity:"untrusted"}))).status).toBe(400);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.listAdminHistoryInitial.mockResolvedValue(snapshot);
    mocks.listAdminHistoryFreshSection.mockResolvedValue({
      groupKey: "completed",
      items: [],
      nextCursor: null,
      totalCount: 3,
      version: "2026-08-31T00:00:02.000Z",
    });
    mocks.listAdminHistoryNextPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it("검색 초기 묶음을 private no-store 응답으로 반환한다", async () => {
    const input = {
      currentOnly: false,
      mode: "initial",
      query: "학생 이름",
      statusFilter: "all",
    } as const;
    const response = await POST(request(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ snapshot });
    expect(mocks.listAdminHistoryInitial).toHaveBeenCalledWith(
      input,
      { userId: "admin-id" },
      expect.any(AbortSignal),
    );
  });

  it("다음 페이지 요청과 잘못된 커서를 구분한다", async () => {
    const input = {
      currentOnly: false,
      cursor: "opaque-cursor",
      groupKey: "open",
      mode: "page",
      query: "",
      statusFilter: "all",
    } as const;
    const success = await POST(request(input));
    expect(success.status).toBe(200);
    expect(mocks.listAdminHistoryNextPage).toHaveBeenCalledWith(
      input,
      { userId: "admin-id" },
      expect.any(AbortSignal),
    );

    mocks.listAdminHistoryNextPage.mockRejectedValueOnce(
      new AdminHistoryCursorError(),
    );
    const invalid = await POST(request(input));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");
  });

  it("변경된 한 구역을 private no-store로 반환한다", async () => {
    const input = {
      currentOnly: false,
      groupKey: "completed",
      mode: "section",
      query: "",
      snapshotAt: "2026-08-31T00:00:02.000Z",
      statusFilter: "all",
    } as const;
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listAdminHistoryFreshSection).toHaveBeenCalledWith(
      input,
      { userId: "admin-id" },
      expect.any(AbortSignal),
    );
    expect(await response.json()).toMatchObject({
      section: { totalCount: 3 },
    });
  });

  it("비로그인·다른 origin·잘못된 body에서는 조회하지 않는다", async () => {
    mocks.getAdminContext.mockResolvedValueOnce(null);
    const unauthorized = await POST(request({
      currentOnly: false,
      mode: "initial",
      query: "",
      statusFilter: "all",
    }));
    expect(unauthorized.status).toBe(401);

    const blocked = await POST(request({
      currentOnly: false,
      mode: "initial",
      query: "",
      statusFilter: "all",
    }, "https://attacker.example"));
    expect(blocked.status).toBe(403);

    const invalid = await POST(request({
      currentOnly: false,
      mode: "initial",
      query: "",
      statusFilter: "unknown",
    }));
    expect(invalid.status).toBe(400);
    expect(mocks.listAdminHistoryInitial).not.toHaveBeenCalled();
    expect(mocks.listAdminHistoryNextPage).not.toHaveBeenCalled();
  });

  it("인증과 내역 시간 초과를 503 재시도 응답으로 구분한다", async () => {
    mocks.getAdminContext.mockRejectedValueOnce(
      new mocks.AdminAuthenticationUnavailableError(
        "관리자 인증 서버의 응답이 늦어지고 있습니다.",
      ),
    );
    const input = {
      currentOnly: false,
      mode: "initial",
      query: "",
      statusFilter: "all",
    } as const;
    const authTimeout = await POST(request(input));
    expect(authTimeout.status).toBe(503);
    expect(authTimeout.headers.get("cache-control")).toBe("private, no-store");
    expect(await authTimeout.json()).toMatchObject({
      code: "upstream_timeout",
    });

    mocks.listAdminHistoryInitial.mockRejectedValueOnce(
      new mocks.AdminHistoryReadError(
        "시험 내역 응답이 늦어지고 있습니다. 다시 시도해 주세요.",
        "timeout",
      ),
    );
    const readTimeout = await POST(request(input));
    expect(readTimeout.status).toBe(503);
    expect(readTimeout.headers.get("cache-control")).toBe("private, no-store");
    expect(await readTimeout.json()).toMatchObject({
      code: "upstream_timeout",
    });
  });
});
