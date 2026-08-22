import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockReviewAssignmentDraftCancelError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "not_found"
        | "unavailable",
    ) {
      super(reason);
    }
  }

  return {
    getAdminContext: vi.fn(),
    cancelStudentReviewAssignmentDraft: vi.fn(),
    ReviewAssignmentDraftCancelError:
      MockReviewAssignmentDraftCancelError,
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/services/review-assignment-service", () => ({
  cancelStudentReviewAssignmentDraft:
    mocks.cancelStudentReviewAssignmentDraft,
  ReviewAssignmentDraftCancelError:
    mocks.ReviewAssignmentDraftCancelError,
}));

import { POST as retireReviewAssignment } from "@/app/api/admin/review-assignments/route";
import { POST as retireReviewDraftCreation } from "@/app/api/admin/students/[id]/review-assignment-drafts/route";
import { DELETE as cancelReviewDraft } from "@/app/api/admin/students/[id]/review-assignment-drafts/[draftId]/route";

const studentId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";

function request(url: string, method: "POST" | "DELETE") {
  return new Request(url, { method });
}

describe("퇴역한 별도 오답 시험 HTTP 계약", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.cancelStudentReviewAssignmentDraft.mockResolvedValue(undefined);
  });

  it("두 생성 endpoint 모두 인증 뒤 410으로 종료 상태를 유지한다", async () => {
    const responses = await Promise.all([
      retireReviewAssignment(
        request("http://localhost/api/admin/review-assignments", "POST"),
      ),
      retireReviewDraftCreation(
        request(
          `http://localhost/api/admin/students/${studentId}/review-assignment-drafts`,
          "POST",
        ),
      ),
    ]);

    expect(responses.map((response) => response.status)).toStrictEqual([
      410, 410,
    ]);
    expect(await responses[0].json()).toMatchObject({
      error: expect.stringContaining("별도 오답 시험 배정은 종료"),
    });
    expect(await responses[1].json()).toMatchObject({
      error: expect.stringContaining("이전 재시험 준비 방식은 종료"),
    });
  });

  it("퇴역 endpoint도 다른 origin과 비로그인을 먼저 차단한다", async () => {
    const crossOriginRequest = new Request(
      "http://localhost/api/admin/review-assignments",
      {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      },
    );
    expect((await retireReviewAssignment(crossOriginRequest)).status).toBe(
      403,
    );

    mocks.getAdminContext.mockResolvedValueOnce(null);
    expect(
      (
        await retireReviewAssignment(
          request(
            "http://localhost/api/admin/review-assignments",
            "POST",
          ),
        )
      ).status,
    ).toBe(401);
  });

  it("기존 초안 취소는 pending 복귀 응답과 private no-store를 유지한다", async () => {
    const response = await cancelReviewDraft(
      request(
        `http://localhost/api/admin/students/${studentId}/review-assignment-drafts/${draftId}`,
        "DELETE",
      ),
      { params: Promise.resolve({ id: studentId, draftId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await response.json()).toStrictEqual({
      status: "cancelled",
      queueDisposition: "pending",
    });
    expect(
      mocks.cancelStudentReviewAssignmentDraft,
    ).toHaveBeenCalledWith(studentId, draftId, { userId: "admin-id" });
  });

  it("초안 취소의 UUID와 상태별 HTTP 경계를 보존한다", async () => {
    const invalid = await cancelReviewDraft(
      request(
        "http://localhost/api/admin/students/not-a-uuid/review-assignment-drafts/not-a-uuid",
        "DELETE",
      ),
      {
        params: Promise.resolve({
          id: "not-a-uuid",
          draftId: "not-a-uuid",
        }),
      },
    );
    expect(invalid.status).toBe(400);

    for (const [reason, status] of [
      ["forbidden", 403],
      ["not_found", 404],
      ["unavailable", 409],
    ] as const) {
      mocks.cancelStudentReviewAssignmentDraft.mockRejectedValueOnce(
        new mocks.ReviewAssignmentDraftCancelError(reason),
      );
      const response = await cancelReviewDraft(
        request(
          `http://localhost/api/admin/students/${studentId}/review-assignment-drafts/${draftId}`,
          "DELETE",
        ),
        { params: Promise.resolve({ id: studentId, draftId }) },
      );
      expect(response.status).toBe(status);
    }
  });
});
