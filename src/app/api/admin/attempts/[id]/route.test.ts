import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminAttemptDetail: vi.fn(),
  getAdminContext: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/features/history/public-server-queries", () => ({
  getAdminAttemptDetail: mocks.getAdminAttemptDetail,
}));

import { GET } from "./route";

const attemptId = "20000000-0000-4000-8000-000000000001";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/admin/attempts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({
      displayName: "관리자",
      userId: "admin-id",
    });
    mocks.getAdminAttemptDetail.mockResolvedValue({ id: attemptId });
  });

  it("응시 상세를 개인 no-store 응답으로 반환한다", async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/attempts/${attemptId}`),
      context(attemptId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getAdminAttemptDetail).toHaveBeenCalledWith(
      attemptId,
      { displayName: "관리자", userId: "admin-id" },
    );
  });

  it("로그인·주소·미존재를 각각 구분한다", async () => {
    mocks.getAdminContext.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost"), context(attemptId))).status)
      .toBe(401);

    expect((await GET(new Request("http://localhost"), context("bad"))).status)
      .toBe(400);

    mocks.getAdminAttemptDetail.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost"), context(attemptId))).status)
      .toBe(404);

    mocks.getAdminAttemptDetail.mockRejectedValueOnce(new Error("database"));
    const failed = await GET(
      new Request("http://localhost"),
      context(attemptId),
    );
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
  });
});
