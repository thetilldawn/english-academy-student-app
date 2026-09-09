import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkSubmitContract } from "@/test-support/assignment-contract-fixtures";

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
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/features/assignments/server/use-cases/bulk-assignment-service", () => ({
  BulkAssignmentError: mocks.BulkAssignmentError,
  createBulkAssignments: mocks.createBulkAssignments,
}));

import { POST } from "@/app/api/admin/bulk-assignments/route";

function request(body: unknown = bulkSubmitContract) {
  return new Request("http://localhost/api/admin/bulk-assignments", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/admin/bulk-assignments", () => {
  it("저장 입구도 실제 스키마로 이어가기 조건을 검사한다", async () => {
    const response = await POST(request({ ...bulkSubmitContract,
      commonPlan: { ...bulkSubmitContract.commonPlan,
        questionCount: { mode: "all" }, overflowPolicy: "continue_weekly" },
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "회차당 단어 수를 먼저 입력해 주세요.",
      code: "invalid_assignment_condition", fieldPath: "commonPlan.overflowPolicy" });
    expect(mocks.createBulkAssignments).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({
      displayName: "테스트 관리자",
      userId: "admin-id",
    });
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
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toHaveProperty("error");
  });
});
