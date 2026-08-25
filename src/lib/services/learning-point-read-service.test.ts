import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({ rpc: mocks.rpc }),
}));

import {
  getAdminAttemptPointSummary,
  getStudentAttemptPointSummary,
  getStudentPointBalance,
  listStudentPointBalances,
} from "./learning-point-read-service";

describe("learning point read service", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it("loads unique students once and supplies zero for a missing total", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { student_id: "student-a", current_points: "12" },
        { student_id: "student-b", current_points: -4 },
      ],
      error: null,
    });

    const balances = await listStudentPointBalances([
      "student-a",
      "student-b",
      "student-c",
      "student-a",
    ]);

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_student_point_totals_v1",
      { p_student_ids: ["student-a", "student-b", "student-c"] },
    );
    expect([...balances]).toEqual([
      ["student-a", 12],
      ["student-b", 0],
      ["student-c", 0],
    ]);
  });

  it("does not query for an empty student list", async () => {
    expect(await listStudentPointBalances([])).toEqual(new Map());
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reads one student through the same batched path", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ student_id: "student-a", current_points: 7 }],
      error: null,
    });

    expect(await getStudentPointBalance("student-a")).toBe(7);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("keeps a zero-point event distinct from an old attempt with no events", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{
          event_count: 1,
          correct_reward: 0,
          wrong_effect: 0,
          net_change: 0,
          current_points: 3,
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{
          event_count: 0,
          correct_reward: 0,
          wrong_effect: 0,
          net_change: 0,
          current_points: 3,
        }],
        error: null,
      });

    expect(
      await getStudentAttemptPointSummary("student-a", "attempt-new"),
    ).toEqual({ attemptPoints: 0, currentPoints: 3 });
    expect(
      await getStudentAttemptPointSummary("student-a", "attempt-old"),
    ).toBeNull();
  });

  it("never exposes a negative attempt value to the student model", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        event_count: "2",
        correct_reward: "2",
        wrong_effect: "-3",
        net_change: "-1",
        current_points: "0",
      }],
      error: null,
    });

    expect(
      await getStudentAttemptPointSummary("student-a", "attempt-a"),
    ).toEqual({ attemptPoints: 0, currentPoints: 0 });
  });

  it("keeps the signed breakdown only in the admin model", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        event_count: 2,
        correct_reward: 2,
        wrong_effect: -3,
        net_change: -1,
        current_points: 0,
      }],
      error: null,
    });

    expect(
      await getAdminAttemptPointSummary("student-a", "attempt-a"),
    ).toEqual({
      correctReward: 2,
      wrongEffect: -3,
      netChange: -1,
      currentPoints: 0,
    });
  });

  it("fails closed on database and unsafe integer responses", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValueOnce({
        data: [{ student_id: "student-a", current_points: "not-a-number" }],
        error: null,
      });

    await expect(getStudentPointBalance("student-a")).rejects.toThrow(
      "학생 포인트를 불러오지 못했습니다.",
    );
    await expect(getStudentPointBalance("student-a")).rejects.toThrow(
      "포인트 합계 값이 올바르지 않습니다.",
    );
  });
});
