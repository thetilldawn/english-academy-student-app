import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockBulkAssignmentError extends Error {
    constructor(
      public readonly reason:
        | "conflict"
        | "invalid_selection"
        | "database",
      message = "검수된 문제를 불러오지 못했습니다.",
    ) {
      super(message);
    }
  }

  return {
    BulkAssignmentError: MockBulkAssignmentError,
    getAdminContext: vi.fn(),
    parseJson: vi.fn(),
    previewBulkAssignments: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/http", () => ({
  isSameOriginRequest: (request: Request) => {
    const origin = request.headers.get("origin");
    return origin === null || origin === new URL(request.url).origin;
  },
  parseJson: mocks.parseJson,
  privateJsonError: (message: string, status: number) =>
    Response.json(
      { error: message },
      { status, headers: { "Cache-Control": "private, no-store" } },
    ),
}));

vi.mock(
  "@/features/assignments/server/use-cases/bulk-assignment-service",
  () => ({
    BulkAssignmentError: mocks.BulkAssignmentError,
    previewBulkAssignments: mocks.previewBulkAssignments,
  }),
);

import { POST } from "./route";

function request(origin?: string) {
  return new Request("http://localhost/api/admin/bulk-assignments/preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: "{}",
  });
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

describe("POST /api/admin/bulk-assignments/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue(null);
    mocks.parseJson.mockResolvedValue({ request: "valid" });
    mocks.previewBulkAssignments.mockResolvedValue({ items: [] });
  });

  it("다른 출처의 요청 오류도 개인 캐시 금지 응답으로 반환한다", async () => {
    const response = await POST(request("https://evil.example"));

    expect(response.status).toBe(403);
    expectPrivateNoStore(response);
    expect(mocks.getAdminContext).not.toHaveBeenCalled();
  });

  it("로그인 오류도 개인 캐시 금지 응답으로 반환한다", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expectPrivateNoStore(response);
    expect(mocks.previewBulkAssignments).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_selection", 422],
    ["conflict", 409],
    ["database", 503],
  ] as const)("%s 오류의 안전한 안내를 HTTP %i로 반환한다", async (reason, status) => {
    mocks.getAdminContext.mockResolvedValue({
      displayName: "테스트 관리자",
      userId: "admin-id",
    });
    mocks.previewBulkAssignments.mockRejectedValueOnce(
      new mocks.BulkAssignmentError(reason),
    );

    const response = await POST(request());

    expect(response.status).toBe(status);
    expectPrivateNoStore(response);
    expect(await response.json()).toEqual({
      error: "검수된 문제를 불러오지 못했습니다.",
    });
  });
});
