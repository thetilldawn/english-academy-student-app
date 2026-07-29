import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockMixedAssignmentError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "conflict"
        | "unavailable"
        | "invalid_selection"
        | "database",
    ) {
      super("mixed assignment error");
    }
  }

  return {
    getAdminContext: vi.fn(),
    createMixedAssignment: vi.fn(),
    MixedAssignmentError: MockMixedAssignmentError,
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/services/mixed-assignment-service", () => ({
  createMixedAssignment: mocks.createMixedAssignment,
  MixedAssignmentError: mocks.MixedAssignmentError,
}));

import { POST } from "@/app/api/admin/mixed-assignments/route";

const validInput = {
  studentId: "11111111-1111-4111-8111-111111111111",
  datasetId: "22222222-2222-4222-8222-222222222222",
  primaryUnitIds: [
    "33333333-3333-4333-8333-333333333333",
  ],
  reviewLevels: [1, 2],
  reviewLimit: 3,
  totalQuestionCount: 10,
  title: "",
  englishToKoreanRatio: 50,
  timeLimitSeconds: 300,
  passingScore: 80,
  questionOrderMode: "random",
  availableUntil: null,
};

function request(
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(
    "http://localhost/api/admin/mixed-assignments",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/admin/mixed-assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({
      userId: "admin-id",
    });
    mocks.createMixedAssignment.mockResolvedValue(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("same-origin 관리자 입력만 받아 private 201로 반환한다", async () => {
    const response = await POST(request(validInput));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await response.json()).toEqual({
      assignmentId:
        "44444444-4444-4444-8444-444444444444",
    });
    expect(mocks.createMixedAssignment).toHaveBeenCalledWith(
      validInput,
      { userId: "admin-id" },
    );
  });

  it("오답 상한이 총 문항보다 커도 실제 선택 수 판단을 서비스에 맡긴다", async () => {
    const input = {
      ...validInput,
      reviewLimit: 20,
      totalQuestionCount: 10,
    };

    const response = await POST(request(input));

    expect(response.status).toBe(201);
    expect(mocks.createMixedAssignment).toHaveBeenCalledWith(
      input,
      { userId: "admin-id" },
    );
  });

  it("다른 origin·비로그인·strict parse 실패를 차단한다", async () => {
    expect(
      (
        await POST(
          request(validInput, {
            origin: "https://attacker.example",
          }),
        )
      ).status,
    ).toBe(403);

    mocks.getAdminContext.mockResolvedValueOnce(null);
    expect((await POST(request(validInput))).status).toBe(401);

    expect(
      (
        await POST(
          request({
            ...validInput,
            selectedQueueIds: [
              "55555555-5555-4555-8555-555555555555",
            ],
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.createMixedAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", 403],
    ["conflict", 409],
    ["unavailable", 409],
    ["invalid_selection", 422],
    ["database", 503],
  ] as const)("%s 오류를 HTTP %i로 변환한다", async (reason, status) => {
    mocks.createMixedAssignment.mockRejectedValueOnce(
      new mocks.MixedAssignmentError(reason),
    );

    const response = await POST(request(validInput));
    expect(response.status).toBe(status);
    expect(await response.json()).toHaveProperty("error");
  });
});
