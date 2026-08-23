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
    createDirectReviewAssignment: vi.fn(),
    DirectReviewAssignmentError: MockDirectReviewAssignmentError,
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/services/direct-review-assignment-service", () => ({
  createDirectReviewAssignment: mocks.createDirectReviewAssignment,
  DirectReviewAssignmentError: mocks.DirectReviewAssignmentError,
}));

import { POST } from "@/app/api/admin/exact-review-assignments/route";

const validInput = {
  studentId: "11111111-1111-4111-8111-111111111111",
  datasetId: "22222222-2222-4222-8222-222222222222",
  primaryUnitIds: ["33333333-3333-4333-8333-333333333333"],
  reviewLevels: [2],
  reviewScope: "dataset",
  totalQuestionCount: 1,
  title: "오답 시험",
  englishToKoreanRatio: 100,
  timeLimitSeconds: 300,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "random",
  availableUntil: null,
  timingMode: "none",
  questionTimeLimitSeconds: null,
};

function request(body: unknown) {
  return new Request("http://localhost/api/admin/exact-review-assignments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/exact-review-assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.createDirectReviewAssignment.mockResolvedValue(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("오답 1개를 서비스에 전달하고 201로 반환한다", async () => {
    const response = await POST(request(validInput));

    expect(response.status).toBe(201);
    expect(mocks.createDirectReviewAssignment).toHaveBeenCalledWith(
      validInput,
      { userId: "admin-id" },
    );
  });

  it("오답 0개는 서비스 호출 전에 차단한다", async () => {
    const response = await POST(request({
      ...validInput,
      totalQuestionCount: 0,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createDirectReviewAssignment).not.toHaveBeenCalled();
  });
});
