import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkPreviewContract } from "@/test-support/assignment-contract-fixtures";

const mocks = vi.hoisted(() => {
  class MockBulkAssignmentError extends Error {
    constructor(
      public readonly reason:
        | "conflict"
        | "invalid_selection"
        | "database",
      message = "검수된 문제를 불러오지 못했습니다.",
    ) {
      super(message);
    }
  }

  return {
    BulkAssignmentError: MockBulkAssignmentError,
    getAdminContext: vi.fn(),
    previewBulkAssignments: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));


vi.mock(
  "@/features/assignments/server/use-cases/bulk-assignment-service",
  () => ({
    BulkAssignmentError: mocks.BulkAssignmentError,
    previewBulkAssignments: mocks.previewBulkAssignments,
  }),
);

import { POST } from "./route";

function request(origin?: string, body: unknown = bulkPreviewContract) {
  return new Request("http://localhost/api/admin/bulk-assignments/preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

describe("POST /api/admin/bulk-assignments/preview", () => {
  it.each([undefined, "unknown"])("구 화면과 미지원 버전(%s)에는 기존 수량 응답을 유지한다", async (version) => {
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    const preview = {
      items: [{ studentId: "student-id", sessions: [], availableQuestionCount: 108,
        countBreakdown: { selectedSourceCount: 118 }, uniqueScheduledQuestionCount: 108 }],
      commonPlanSummary: { scheduledQuestionCount: 108, uniqueScheduledQuestionCount: 108 },
      planSignature: "same-plan",
    };
    mocks.previewBulkAssignments.mockResolvedValue(preview);
    const legacyRequest = request();
    if (version) legacyRequest.headers.set("x-assignment-preview-counts", version);
    const response = await POST(legacyRequest);
    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(await response.json()).toEqual({
      items: [{ studentId: "student-id", sessions: [], availableQuestionCount: 108 }],
      commonPlanSummary: { scheduledQuestionCount: 108 }, planSignature: "same-plan",
    });
    expect(preview.items[0].uniqueScheduledQuestionCount).toBe(108);
    expect(preview.commonPlanSummary.uniqueScheduledQuestionCount).toBe(108);
  });

  it("새 화면에는 항목과 공통 요약의 수량 상세를 그대로 전달한다", async () => {
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    const preview = { items: [{ countBreakdown: null, uniqueScheduledQuestionCount: 108 }],
      commonPlanSummary: { uniqueScheduledQuestionCount: 108 }, planSignature: "same-plan" };
    mocks.previewBulkAssignments.mockResolvedValue(preview);
    const currentRequest = request();
    currentRequest.headers.set("x-assignment-preview-counts", "1");
    const response = await POST(currentRequest);
    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(await response.json()).toEqual(preview);
  });

  it("서버가 거부한 이어가기 조건을 입력 위치와 함께 반환한다", async () => {
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    const response = await POST(request(undefined, {
      ...bulkPreviewContract, commonPlan: { ...bulkPreviewContract.commonPlan,
        questionCount: { mode: "all" }, overflowPolicy: "continue_weekly" },
    }));
    expect(response.status).toBe(400);
    expectPrivateNoStore(response);
    expect(await response.json()).toEqual({ error: "회차당 단어 수를 먼저 입력해 주세요.",
      code: "invalid_assignment_condition", fieldPath: "commonPlan.overflowPolicy" });
    expect(mocks.previewBulkAssignments).not.toHaveBeenCalled();
  });

  it("잘못된 요청 본문에는 내부 검증 원문을 반환하지 않는다", async () => {
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    const response = await POST(request(undefined, { commonPlan: "private-source" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "학생 선택과 출제 조건을 확인해 주세요." });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue(null);
    mocks.previewBulkAssignments.mockResolvedValue({ items: [] });
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

  it.each([
    ["invalid_selection", 422],
    ["conflict", 409],
    ["database", 503],
  ] as const)("%s 오류의 안전한 안내를 HTTP %i로 반환한다", async (reason, status) => {
    mocks.getAdminContext.mockResolvedValue({
      displayName: "테스트 관리자",
      userId: "admin-id",
    });
    mocks.previewBulkAssignments.mockRejectedValueOnce(
      new mocks.BulkAssignmentError(reason),
    );

    const response = await POST(request());

    expect(response.status).toBe(status);
    expectPrivateNoStore(response);
    expect(await response.json()).toEqual({
      error: "검수된 문제를 불러오지 못했습니다.",
    });
  });
});
