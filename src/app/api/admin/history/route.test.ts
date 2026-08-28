import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAdminHistoryReadError extends Error {}

  return {
    AdminHistoryReadError: MockAdminHistoryReadError,
    getAdminContext: vi.fn(),
    listAdminHistoryInitial: vi.fn(),
    listAdminHistoryNextPage: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/features/history/server/queries/admin-history-read-error", () => ({
  AdminHistoryReadError: mocks.AdminHistoryReadError,
}));
vi.mock("@/features/history/server/queries/admin-history-list-query", () => ({
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
    );

    mocks.listAdminHistoryNextPage.mockRejectedValueOnce(
      new AdminHistoryCursorError(),
    );
    const invalid = await POST(request(input));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("private, no-store");
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
});
