import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockDirectReviewAssignmentError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "conflict"
        | "unavailable"
        | "invalid_selection"
        | "database",
      message = "direct review assignment error",
      public readonly fieldPath?: string,
    ) {
      super(message);
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
  idempotencyKey: "99999999-9999-4999-8999-999999999999",
  studentId: "11111111-1111-4111-8111-111111111111",
  datasetId: "22222222-2222-4222-8222-222222222222",
  reviewLevels: [2],
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.createDirectReviewAssignment.mockResolvedValue(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("오답 1개를 서비스에 전달하고 201로 반환한다", async () => {
    const commandNowMilliseconds = Date.parse("2026-08-28T04:05:06.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(commandNowMilliseconds);
    const response = await POST(request(validInput));

    expect(response.status).toBe(201);
    expect(mocks.createDirectReviewAssignment).toHaveBeenCalledWith(
      validInput,
      { userId: "admin-id" },
      { commandNowMilliseconds },
    );
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });

  it("오답 0개는 서비스 호출 전에 차단한다", async () => {
    const response = await POST(request({
      ...validInput,
      totalQuestionCount: 0,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createDirectReviewAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ["누락", undefined],
    ["형식 오류", "not-a-uuid"],
  ])("멱등키 %s는 서비스 호출 전에 차단한다", async (_label, value) => {
    const response = await POST(request({
      ...validInput,
      idempotencyKey: value,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createDirectReviewAssignment).not.toHaveBeenCalled();
  });

  it("저장 직전 오답 목록이 바뀌면 409로 다시 계산을 요구한다", async () => {
    mocks.createDirectReviewAssignment.mockRejectedValue(
      new mocks.DirectReviewAssignmentError("conflict"),
    );

    const response = await POST(request(validInput));

    expect(response.status).toBe(409);
  });

  it("서버 도착 중 지난 마감은 deadline 입력 오류로 반환한다", async () => {
    mocks.createDirectReviewAssignment.mockRejectedValue(
      new mocks.DirectReviewAssignmentError(
        "invalid_selection",
        "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
        "deadline",
      ),
    );

    const response = await POST(request(validInput));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
      fieldPath: "deadline",
    });
  });
});
