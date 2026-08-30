import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  getServiceSupabaseClient: vi.fn(),
  parseSummary: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: mocks.getServiceSupabaseClient,
}));
vi.mock("./vocab-assignment-queue-query", () => ({
  parseVocabAssignmentQueueSummary: mocks.parseSummary,
}));

import {
  resolveVocabAssignmentQueueAttention,
  VocabAssignmentQueueCommandError,
} from "./vocab-assignment-queue-command";

const seriesId = "00000000-0000-4000-8000-000000000033";
const studentId = "00000000-0000-4000-8000-000000000020";

describe("vocab assignment queue command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc: mocks.rpc });
    mocks.parseSummary.mockReturnValue({
      seriesId,
      studentId,
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
    mocks.rpc.mockResolvedValue({
      data: {
        queue: { series_id: seriesId },
        resolution: {
          action: "retry",
          series_id: seriesId,
          student_id: studentId,
        },
      },
      error: null,
    });
  });

  it("대상 회차를 원자 처리하는 v2 영수증만 성공으로 사용한다", async () => {
    await expect(resolveVocabAssignmentQueueAttention(
      seriesId,
      "retry",
      { displayName: "관리자", userId: "admin-id" },
    )).resolves.toMatchObject({
      queue: { seriesId },
      resolution: { action: "retry", series_id: seriesId },
      version: "2026-08-31T00:00:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "resolve_vocab_assignment_queue_attention_v2",
      { p_action: "retry", p_series_id: seriesId },
    );
  });

  it("원자 생성 실패와 대상 불일치를 DB 실패로 구분한다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "materialization failed" },
    });
    await expect(resolveVocabAssignmentQueueAttention(
      seriesId,
      "retry",
      { displayName: "관리자", userId: "admin-id" },
    )).rejects.toMatchObject({ reason: "database" });

    mocks.parseSummary.mockReturnValueOnce({
      seriesId: "00000000-0000-4000-8000-000000000099",
      studentId,
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
    await expect(resolveVocabAssignmentQueueAttention(
      seriesId,
      "retry",
      { displayName: "관리자", userId: "admin-id" },
    )).rejects.toBeInstanceOf(VocabAssignmentQueueCommandError);
  });

  it("요청·학생·처리 방식이 서로 맞는 영수증만 허용한다", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        queue: { series_id: seriesId },
        resolution: {
          action: "skip",
          series_id: seriesId,
          student_id: studentId,
        },
      },
      error: null,
    });
    await expect(resolveVocabAssignmentQueueAttention(
      seriesId,
      "retry",
      { displayName: "관리자", userId: "admin-id" },
    )).rejects.toMatchObject({ reason: "database" });

    mocks.rpc.mockResolvedValueOnce({
      data: {
        queue: { series_id: seriesId },
        resolution: {
          action: "retry",
          series_id: seriesId,
          student_id: "00000000-0000-4000-8000-000000000099",
        },
      },
      error: null,
    });
    await expect(resolveVocabAssignmentQueueAttention(
      seriesId,
      "retry",
      { displayName: "관리자", userId: "admin-id" },
    )).rejects.toMatchObject({ reason: "database" });
  });
});
