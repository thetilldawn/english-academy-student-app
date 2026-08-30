import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  previewBulkAssignments: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock(
  "@/features/assignments/server/use-cases/bulk-assignment-service",
  () => ({ previewBulkAssignments: mocks.previewBulkAssignments }),
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
});
