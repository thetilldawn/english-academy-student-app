import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAssignmentReplacementError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "not_found"
        | "blocked"
        | "started"
        | "completed"
        | "missed"
        | "cancelled"
        | "deleted"
        | "closed"
        | "deadline_elapsed"
        | "unavailable"
        | "conflict"
        | "invalid_selection"
        | "database",
      message = "replacement error",
      public readonly fieldPath?: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  }

  return {
    getAdminContext: vi.fn(),
    getStudentAssignmentEditDraft: vi.fn(),
    calculateStudentAssignmentReplacementCapacity: vi.fn(),
    replaceStudentAssignment: vi.fn(),
    cancelStudentAssignment: vi.fn(),
    AssignmentReplacementError: MockAssignmentReplacementError,
    AssignmentCancellationError: class extends Error {},
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/services/assignment-replacement-service", () => ({
  replaceStudentAssignment: mocks.replaceStudentAssignment,
}));

vi.mock(
  "@/lib/services/assignment-replacement-preparation-service",
  () => ({
    calculateStudentAssignmentReplacementCapacity:
      mocks.calculateStudentAssignmentReplacementCapacity,
  }),
);

vi.mock("@/lib/services/assignment-edit-source-service", () => ({
  getStudentAssignmentEditDraft:
    mocks.getStudentAssignmentEditDraft,
}));

vi.mock("@/lib/services/assignment-replacement-errors", () => ({
  AssignmentReplacementError: mocks.AssignmentReplacementError,
}));

vi.mock("@/lib/services/assignment-cancellation-service", () => ({
  cancelStudentAssignment: mocks.cancelStudentAssignment,
  AssignmentCancellationError: mocks.AssignmentCancellationError,
}));

import {
  GET,
  POST,
  PUT,
} from "@/app/api/admin/assignments/[assignmentId]/students/[studentId]/route";
import { hydrateSingleAssignmentDraftFromEditResponse } from "@/features/assignments/api/edit-draft-adapter";

const assignmentId = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222";
const datasetId = "33333333-3333-4333-8333-333333333333";
const unitId = "44444444-4444-4444-8444-444444444444";
const replacementId = "55555555-5555-4555-8555-555555555555";
const admin = { userId: "admin-id" };
const params = Promise.resolve({ assignmentId, studentId });

const previewInput = {
  studentId,
  datasetId,
  primaryUnitIds: [unitId],
  includePendingReview: false,
  reviewLevels: [1, 2],
  englishToKoreanRatio: 50,
};

const replacementInput = {
  idempotencyKey: "66666666-6666-4666-8666-666666666666",
  title: "수정 시험",
  datasetId,
  primaryUnitIds: [unitId],
  includePendingReview: false,
  reviewLevels: [1, 2],
  questionCount: 10,
  englishToKoreanRatio: 50,
  timeLimitSeconds: 300,
  timingMode: "total",
  questionTimeLimitSeconds: null,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "random",
  availableFrom: null,
  availableUntil: null,
  reviewScope: "dataset",
};

const mixedEditDraftResponse = {
  assignmentId,
  studentId,
  studentName: "검증 학생",
  purpose: "mixed" as const,
  title: "기존 혼합 시험",
  datasetId,
  primaryUnitIds: [unitId],
  questionCount: 10,
  englishToKoreanRatio: 50 as const,
  timeLimitSeconds: 300,
  timingMode: "total" as const,
  questionTimeLimitSeconds: null,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "random" as const,
  availableFrom: null,
  availableUntil: "2026-08-18T12:00:00.000Z",
  includePendingReview: true,
  reviewScope: "dataset" as const,
  reviewLevels: [2] as (1 | 2)[],
  seriesItem: false,
};

function request(method: "GET" | "POST" | "PUT", body?: unknown) {
  return new Request(
    `http://localhost/api/admin/assignments/${assignmentId}/students/${studentId}`,
    {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

describe("student assignment replacement route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue(admin);
    mocks.getStudentAssignmentEditDraft.mockResolvedValue({
      assignmentId,
      studentId,
      title: "기존 시험",
    });
    mocks.calculateStudentAssignmentReplacementCapacity.mockResolvedValue({
      maximumQuestionCount: 20,
    });
    mocks.replaceStudentAssignment.mockResolvedValue({
      status: "replaced",
      sourceAssignmentId: assignmentId,
      replacementAssignmentId: replacementId,
      studentId,
      replacementPurpose: "regular",
      idempotent: false,
    });
  });

  it("GET·preview POST·replacement PUT가 같은 학생별 자원을 사용한다", async () => {
    const getResponse = await GET(request("GET"), { params });
    const previewResponse = await POST(
      request("POST", previewInput),
      { params },
    );
    const putResponse = await PUT(
      request("PUT", replacementInput),
      { params },
    );

    expect(getResponse.status).toBe(200);
    expect(previewResponse.status).toBe(200);
    expect(putResponse.status).toBe(200);
    expectPrivateNoStore(getResponse);
    expectPrivateNoStore(previewResponse);
    expectPrivateNoStore(putResponse);
    expect(mocks.getStudentAssignmentEditDraft).toHaveBeenCalledWith(
      assignmentId,
      studentId,
      admin,
      { nowMilliseconds: expect.any(Number) },
    );
    expect(
      mocks.calculateStudentAssignmentReplacementCapacity,
    ).toHaveBeenCalledWith(
      assignmentId,
      studentId,
      previewInput,
      admin,
      { nowMilliseconds: expect.any(Number) },
    );
    expect(mocks.replaceStudentAssignment).toHaveBeenCalledWith(
      assignmentId,
      studentId,
      replacementInput,
      admin,
      { commandNowMilliseconds: expect.any(Number) },
    );
  });

  it("PUT 명령 시각을 한 번만 확정해 service에 전달한다", async () => {
    const commandNowMilliseconds = Date.parse("2026-08-29T03:04:05.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(commandNowMilliseconds);

    const response = await PUT(request("PUT", replacementInput), { params });

    expect(response.status).toBe(200);
    expect(nowSpy).toHaveBeenCalledTimes(1);
    expect(mocks.replaceStudentAssignment).toHaveBeenCalledWith(
      assignmentId,
      studentId,
      replacementInput,
      admin,
      { commandNowMilliseconds },
    );
    nowSpy.mockRestore();
  });

  it("GET의 전체 mixed 응답을 strict parser와 edit draft hydration까지 전달한다", async () => {
    mocks.getStudentAssignmentEditDraft.mockResolvedValueOnce(
      mixedEditDraftResponse,
    );

    const response = await GET(request("GET"), { params });
    const draft = hydrateSingleAssignmentDraftFromEditResponse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(draft).toMatchObject({
      operation: {
        mode: "replace",
        assignmentId,
        targetStudentId: studentId,
        sourcePurpose: "mixed",
      },
      studentId,
      title: { mode: "source", value: "기존 혼합 시험" },
      range: { datasetId, orderedUnitIds: [unitId] },
      questionCount: { mode: "manual", value: 10 },
      review: { mode: "pending", scope: "dataset", levels: [2] },
      deadline: {
        mode: "at",
        koreanLocalDateTime: "2026-08-18T21:00",
      },
    });
  });

  it("다른 origin·비로그인·strict body를 차단한다", async () => {
    const foreignRequest = request("PUT", replacementInput);
    foreignRequest.headers.set("origin", "https://attacker.example");
    expect((await PUT(foreignRequest, { params })).status).toBe(403);

    mocks.getAdminContext.mockResolvedValueOnce(null);
    expect((await GET(request("GET"), { params })).status).toBe(401);

    expect(
      (
        await PUT(
          request("PUT", { ...replacementInput, selectedQueueIds: [] }),
          { params },
        )
      ).status,
    ).toBe(400);
    expect(mocks.replaceStudentAssignment).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", 403],
    ["not_found", 404],
    ["blocked", 409],
    ["started", 409],
    ["completed", 409],
    ["missed", 409],
    ["cancelled", 409],
    ["deleted", 409],
    ["closed", 409],
    ["deadline_elapsed", 409],
    ["unavailable", 409],
    ["conflict", 409],
    ["invalid_selection", 422],
    ["database", 503],
  ] as const)("%s 오류를 HTTP %i로 변환한다", async (reason, status) => {
    mocks.replaceStudentAssignment.mockRejectedValueOnce(
      new mocks.AssignmentReplacementError(reason),
    );
    const response = await PUT(
      request("PUT", replacementInput),
      { params },
    );
    expect(response.status).toBe(status);
    expectPrivateNoStore(response);
    expect(await response.json()).toHaveProperty("error");
  });

  it("지난 새 마감을 422 deadline 입력 오류로 전달한다", async () => {
    mocks.replaceStudentAssignment.mockRejectedValueOnce(
      new mocks.AssignmentReplacementError(
        "invalid_selection",
        "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
        "deadline",
        "assignment_deadline_elapsed",
      ),
    );

    const response = await PUT(request("PUT", replacementInput), { params });

    expect(response.status).toBe(422);
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "assignment_deadline_elapsed",
      fieldPath: "deadline",
    });
  });

  it.each([
    "assignment_source_changed",
    "idempotency_key_reused",
  ] as const)("수정 충돌 코드 %s를 409 응답에 보존한다", async (code) => {
    mocks.replaceStudentAssignment.mockRejectedValueOnce(
      new mocks.AssignmentReplacementError(
        "conflict",
        "배정 상태가 바뀌었습니다.",
        undefined,
        code,
      ),
    );

    const response = await PUT(request("PUT", replacementInput), { params });

    expect(response.status).toBe(409);
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ code });
  });
});
