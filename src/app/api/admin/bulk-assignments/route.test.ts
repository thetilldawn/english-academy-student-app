import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockBulkAssignmentError extends Error {
    constructor(
      public readonly reason:
        | "conflict"
        | "invalid_selection"
        | "database",
    ) {
      super("bulk assignment error");
    }
  }

  return {
    BulkAssignmentError: MockBulkAssignmentError,
    createBulkAssignments: vi.fn(),
    getAdminContext: vi.fn(),
    parseJson: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/http", () => ({
  isSameOriginRequest: () => true,
  jsonError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  parseJson: mocks.parseJson,
}));
vi.mock("@/lib/services/bulk-assignment-service", () => ({
  BulkAssignmentError: mocks.BulkAssignmentError,
  createBulkAssignments: mocks.createBulkAssignments,
}));

import { POST } from "@/app/api/admin/bulk-assignments/route";

function request() {
  return new Request("http://localhost/api/admin/bulk-assignments", {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/admin/bulk-assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({
      displayName: "테스트 관리자",
      userId: "admin-id",
    });
    mocks.parseJson.mockResolvedValue({ plan: "valid" });
    mocks.createBulkAssignments.mockResolvedValue([
      { assignmentId: "11111111-1111-4111-8111-111111111111" },
    ]);
  });

  it("정상 입력을 201로 반환한다", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["conflict", 409],
    ["invalid_selection", 422],
    ["database", 503],
  ] as const)("%s 오류를 HTTP %i로 변환한다", async (reason, status) => {
    mocks.createBulkAssignments.mockRejectedValueOnce(
      new mocks.BulkAssignmentError(reason),
    );

    const response = await POST(request());

    expect(response.status).toBe(status);
    expect(await response.json()).toHaveProperty("error");
  });
});
