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
