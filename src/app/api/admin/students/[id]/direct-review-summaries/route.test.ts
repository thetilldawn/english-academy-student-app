import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockDirectReviewCandidateError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "unavailable"
        | "invalid_selection"
        | "database",
    ) {
      super("direct review candidate error");
    }
  }

  return {
    DirectReviewCandidateError: MockDirectReviewCandidateError,
    getAdminContext: vi.fn(),
    listSummaries: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/services/direct-review-candidate-service", () => ({
  DirectReviewCandidateError: mocks.DirectReviewCandidateError,
  listStudentDirectReviewDatasetSummaries: mocks.listSummaries,
}));

import { GET } from "./route";

const studentId = "00000000-0000-4000-8000-000000000020";

describe("GET /api/admin/students/[id]/direct-review-summaries", () => {
  function expectPrivateNoStore(response: Response) {
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.listSummaries.mockResolvedValue([{
      datasetId: "00000000-0000-4000-8000-000000000030",
      latestWrongAt: "2026-08-24T01:00:00.000Z",
      level1Count: 2,
      level2Count: 1,
      totalCount: 3,
    }]);
  });

  it("학생을 열 때만 현재 오답 요약을 no-store로 불러온다", async () => {
    const response = await GET(
      new Request("http://localhost/api/test"),
      { params: Promise.resolve({ id: studentId }) },
    );

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(mocks.listSummaries).toHaveBeenCalledWith(
      studentId,
      { userId: "admin-id" },
    );
    expect(await response.json()).toMatchObject({
      summaries: [{ totalCount: 3 }],
    });
  });

  it("로그인과 올바른 학생 식별자를 요구한다", async () => {
    mocks.getAdminContext.mockResolvedValueOnce(null);
    const authResponse = await GET(
      new Request("http://localhost/api/test"),
      { params: Promise.resolve({ id: studentId }) },
    );
    expect(authResponse.status).toBe(401);
    expectPrivateNoStore(authResponse);

    const invalidStudentResponse = await GET(
      new Request("http://localhost/api/test"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(invalidStudentResponse.status).toBe(400);
    expectPrivateNoStore(invalidStudentResponse);
    expect(mocks.listSummaries).not.toHaveBeenCalled();
  });

  it("활성 학생이 없으면 404로 구분한다", async () => {
    mocks.listSummaries.mockRejectedValue(
      new mocks.DirectReviewCandidateError("unavailable"),
    );

    const response = await GET(
      new Request("http://localhost/api/test"),
      { params: Promise.resolve({ id: studentId }) },
    );

    expect(response.status).toBe(404);
    expectPrivateNoStore(response);
  });

  it.each([
    ["forbidden", 403],
    ["database", 503],
  ] as const)("%s 오류를 %i로 구분한다", async (reason, status) => {
    mocks.listSummaries.mockRejectedValue(
      new mocks.DirectReviewCandidateError(reason),
    );

    const response = await GET(
      new Request("http://localhost/api/test"),
      { params: Promise.resolve({ id: studentId }) },
    );

    expect(response.status).toBe(status);
    expectPrivateNoStore(response);
  });
});
