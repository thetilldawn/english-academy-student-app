import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockDirectReviewAssignmentError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "conflict"
        | "unavailable"
        | "invalid_selection"
        | "database",
    ) {
      super("direct review assignment error");
    }
  }

  return {
    getAdminContext: vi.fn(),
    previewDirectReviewAssignment: vi.fn(),
    DirectReviewAssignmentError: MockDirectReviewAssignmentError,
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/services/direct-review-assignment-service", () => ({
  previewDirectReviewAssignment: mocks.previewDirectReviewAssignment,
  DirectReviewAssignmentError: mocks.DirectReviewAssignmentError,
}));

import { POST } from "@/app/api/admin/exact-review-assignments/preview/route";

const validInput = {
  studentId: "11111111-1111-4111-8111-111111111111",
  datasetId: "22222222-2222-4222-8222-222222222222",
  reviewLevels: [1, 2],
  englishToKoreanRatio: 50,
};

function request(body: unknown, origin?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request(
    "http://localhost/api/admin/exact-review-assignments/preview",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/admin/exact-review-assignments/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.previewDirectReviewAssignment.mockResolvedValue({
      wrongEligible: 3,
      wrongLevel1Eligible: 1,
      wrongLevel2Eligible: 2,
    });
  });

  it("전용 오답 후보 계산 결과를 비공개 응답으로 반환한다", async () => {
    const response = await POST(request(validInput));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      wrongEligible: 3,
      wrongLevel1Eligible: 1,
      wrongLevel2Eligible: 2,
    });
    expect(mocks.previewDirectReviewAssignment).toHaveBeenCalledWith(
      validInput,
      { userId: "admin-id" },
    );
  });

  it("다른 출처와 로그인하지 않은 요청을 차단한다", async () => {
    expect((await POST(request(validInput, "https://evil.example"))).status)
      .toBe(403);

    mocks.getAdminContext.mockResolvedValue(null);
    expect((await POST(request(validInput))).status).toBe(401);
    expect(mocks.previewDirectReviewAssignment).not.toHaveBeenCalled();
  });

  it("혼합 배정 전용 필드가 섞이면 서비스 전에 차단한다", async () => {
    const response = await POST(request({
      ...validInput,
      reviewScope: "dataset",
    }));

    expect(response.status).toBe(400);
    expect(mocks.previewDirectReviewAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", 403],
    ["conflict", 409],
    ["unavailable", 409],
    ["invalid_selection", 422],
    ["database", 503],
  ] as const)("%s 오류를 %i로 구분한다", async (reason, status) => {
    mocks.previewDirectReviewAssignment.mockRejectedValue(
      new mocks.DirectReviewAssignmentError(reason),
    );

    expect((await POST(request(validInput))).status).toBe(status);
  });
});
