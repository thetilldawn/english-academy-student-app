import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockDirectReviewPreparationError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "unavailable"
        | "invalid_selection"
        | "conflict"
        | "database",
    ) {
      super("direct review preparation error");
    }
  }

  return {
    calculate: vi.fn(),
    createServerSupabaseClient: vi.fn(),
    prepare: vi.fn(),
    requireAdmin: vi.fn(),
    DirectReviewPreparationError: MockDirectReviewPreparationError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/services/direct-review-preparation-service", () => ({
  calculateDirectReviewPreview: mocks.calculate,
  DirectReviewPreparationError: mocks.DirectReviewPreparationError,
  prepareDirectReviewAssignmentBatch: mocks.prepare,
}));

import {
  createDirectReviewAssignment,
  DirectReviewAssignmentError,
  previewDirectReviewAssignment,
} from "./direct-review-assignment-service";
import type {
  DirectReviewAssignmentInput,
  DirectReviewPreviewInput,
} from "@/lib/admin/direct-review-assignment-request";

const ids = {
  assignment: "00000000-0000-4000-8000-000000000010",
  dataset: "00000000-0000-4000-8000-000000000020",
  idempotency: "00000000-0000-4000-8000-000000000030",
  questionA: "00000000-0000-4000-8000-000000000040",
  questionB: "00000000-0000-4000-8000-000000000050",
  student: "00000000-0000-4000-8000-000000000060",
} as const;
const admin = { displayName: "테스트 관리자", userId: "admin-id" };

const input: DirectReviewAssignmentInput = {
  availableUntil: null,
  datasetId: ids.dataset,
  englishToKoreanRatio: 50,
  idempotencyKey: ids.idempotency,
  passingScore: 80,
  questionOrderMode: "random",
  questionTimeLimitSeconds: null,
  retryEnabled: true,
  retryPassingScore: 80,
  reviewLevels: [1, 2],
  studentId: ids.student,
  timeLimitSeconds: 300,
  timingMode: "total",
  title: "오답 시험",
  totalQuestionCount: 2,
};

const prepared = {
  availableUntil: null,
  datasetId: ids.dataset,
  englishToKoreanRatio: 50,
  passingScore: 80,
  questionOrderMode: "random" as const,
  questionTimeLimitSeconds: null,
  questions: [1, 2].map((entryId, index) => ({
    base_order_index: index + 1,
    choice_vocab_entry_ids: [1, 2, 3, 4],
    direction: "english_to_korean" as const,
    vocab_entry_id: entryId,
  })),
  retryEnabled: true,
  retryPassingScore: 80,
  reviewLevels: [1, 2] as (1 | 2)[],
  sourceQuestionIds: [ids.questionA, ids.questionB],
  studentId: ids.student,
  timeLimitSeconds: 300,
  timingMode: "total" as const,
  title: "오답 시험",
};

describe("createDirectReviewAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ userId: "admin-id" });
    mocks.prepare.mockResolvedValue(prepared);
  });

  it("완료된 같은 요청은 준비 계산 없이 기존 배정을 돌려준다", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: ids.assignment,
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });

    await expect(createDirectReviewAssignment(input, admin)).resolves.toBe(
      ids.assignment,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "get_current_wrong_review_assignment_result_v1",
      expect.objectContaining({
        p_idempotency_key: ids.idempotency,
        p_student_id: ids.student,
      }),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("현재 후보를 다시 준비한 뒤 같은 해시와 출처로 원자 저장한다", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: ids.assignment, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });

    await expect(createDirectReviewAssignment(input, admin)).resolves.toBe(
      ids.assignment,
    );

    expect(mocks.prepare).toHaveBeenCalledWith(
      input,
      admin,
      expect.objectContaining({ rpc }),
    );
    const lookupArgs = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    const createArgs = rpc.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(lookupArgs.p_request_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(createArgs).toMatchObject({
      p_idempotency_key: ids.idempotency,
      p_request_sha256: lookupArgs.p_request_sha256,
      p_review_levels: [1, 2],
      p_retry_enabled: true,
      p_retry_passing_score: 80,
      p_source_question_ids: [ids.questionA, ids.questionB],
    });
    expect(createArgs.p_questions).toEqual(prepared.questions);
  });

  it.each([
    ["lookup", "23505"],
    ["create", "40001"],
  ] as const)("%s 충돌을 다시 계산이 필요한 상태로 구분한다", async (
    stage,
    code,
  ) => {
    const rpc = stage === "lookup"
      ? vi.fn().mockResolvedValue({ data: null, error: { code } })
      : vi.fn()
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: null, error: { code } });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });

    await expect(createDirectReviewAssignment(input, admin)).rejects.toEqual(
      expect.objectContaining({
      reason: "conflict",
      }) satisfies Partial<DirectReviewAssignmentError>,
    );
  });

  it("후보 조회의 권한 오류를 일반 서버 오류로 숨기지 않는다", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    mocks.prepare.mockRejectedValue(
      new mocks.DirectReviewPreparationError("forbidden"),
    );

    await expect(createDirectReviewAssignment(input, admin)).rejects.toEqual(
      expect.objectContaining({ reason: "forbidden" }),
    );
  });
});

describe("previewDirectReviewAssignment", () => {
  const previewInput: DirectReviewPreviewInput = {
    datasetId: ids.dataset,
    englishToKoreanRatio: 50,
    reviewLevels: [1, 2],
    studentId: ids.student,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue(admin);
  });

  it("전용 계산 경로에 같은 관리자와 DB 연결을 전달한다", async () => {
    const client = { rpc: vi.fn() };
    const preview = {
      wrongEligible: 2,
      wrongLevel1Eligible: 1,
      wrongLevel2Eligible: 1,
    };
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    mocks.calculate.mockResolvedValue(preview);

    await expect(
      previewDirectReviewAssignment(previewInput, admin),
    ).resolves.toEqual(preview);
    expect(mocks.calculate).toHaveBeenCalledWith(
      previewInput,
      admin,
      client,
    );
  });

  it("후보 준비 오류를 공개 서비스 오류로 변환한다", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc: vi.fn() });
    mocks.calculate.mockRejectedValue(
      new mocks.DirectReviewPreparationError("invalid_selection"),
    );

    await expect(
      previewDirectReviewAssignment(previewInput, admin),
    ).rejects.toEqual(expect.objectContaining({
      reason: "invalid_selection",
    }));
  });
});
