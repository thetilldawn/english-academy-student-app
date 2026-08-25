import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAssignmentCreationError extends Error {
    constructor(
      public readonly reason:
        | "conflict"
        | "invalid_selection"
        | "database",
    ) {
      super("regular assignment error");
    }
  }

  return {
    AssignmentCreationError: MockAssignmentCreationError,
    createRegularAssignment: vi.fn(),
    getAdminContext: vi.fn(),
    listAssignments: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/services/admin-assignment-read-service", () => ({
  listAssignments: mocks.listAssignments,
}));

vi.mock("@/lib/services/regular-assignment-service", () => ({
  AssignmentCreationError: mocks.AssignmentCreationError,
  createRegularAssignment: mocks.createRegularAssignment,
}));

import { POST } from "@/app/api/admin/assignments/route";

const validInput = {
  availableUntil: null,
  datasetId: "11111111-1111-4111-8111-111111111111",
  englishToKoreanRatio: 50,
  passingScore: 80,
  questionCount: 20,
  questionOrderMode: "random",
  questionTimeLimitSeconds: null,
  retryEnabled: true,
  retryPassingScore: 80,
  studentIds: ["22222222-2222-4222-8222-222222222222"],
  timeLimitSeconds: 300,
  timingMode: "total",
  title: "단어 시험",
  unitIds: ["33333333-3333-4333-8333-333333333333"],
};

function request(body: unknown) {
  return new Request("http://localhost/api/admin/assignments", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/admin/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({
      displayName: "테스트 관리자",
      userId: "admin-id",
    });
    mocks.createRegularAssignment.mockResolvedValue(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("정상 입력을 201로 반환한다", async () => {
    const response = await POST(request(validInput));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      assignmentId: "44444444-4444-4444-8444-444444444444",
    });
    expect(mocks.createRegularAssignment).toHaveBeenCalledWith(
      validInput,
      {
        displayName: "테스트 관리자",
        userId: "admin-id",
      },
    );
  });

  it.each([
    ["conflict", 409],
    ["invalid_selection", 422],
    ["database", 503],
  ] as const)("%s 오류를 HTTP %i로 변환한다", async (reason, status) => {
    mocks.createRegularAssignment.mockRejectedValueOnce(
      new mocks.AssignmentCreationError(reason),
    );

    const response = await POST(request(validInput));

    expect(response.status).toBe(status);
    expect(await response.json()).toHaveProperty("error");
  });
});
