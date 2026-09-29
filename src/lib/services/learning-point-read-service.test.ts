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

  it("loads unique students once and preserves an explicit zero from the RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { student_id: "student-a", current_points: "12" },
        { student_id: "student-b", current_points: 0 },
        { student_id: "student-c", current_points: "0" },
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


  it.each([null, undefined, "", " ", true, false, [], [0], {}, 1.5, "1.5", "1e2", "0x10", " 0", "0 ", "Infinity", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "9007199254740992", -1])(
    "거짓 0이나 잘못된 합계 %j를 거절한다", async value => {
      mocks.rpc.mockResolvedValue({ data: [{ student_id: "student-a", current_points: value }], error: null });
      await expect(getStudentPointBalance("student-a")).rejects.toThrow();
    },
  );
  it.each([null, [], {}, [null], [{ student_id: "other", current_points: 1 }],
    [{ student_id: "student-a", current_points: 1 }, { student_id: "student-a", current_points: 1 }]])(
    "합계 응답 누락·중복·다른 학생 %j를 거절한다", async data => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(getStudentPointBalance("student-a")).rejects.toThrow();
    },
  );
  it("같은 행 수의 중복과 일부 누락도 거절한다", async () => {
    mocks.rpc.mockResolvedValue({ data: Array.from({ length: 2 }, () => ({ student_id: "student-a", current_points: 1 })), error: null });
    await expect(listStudentPointBalances(["student-a", "student-b"])).rejects.toThrow();
    mocks.rpc.mockResolvedValue({ data: [{ student_id: "student-a", current_points: 1 }], error: null });
    await expect(listStudentPointBalances(["student-a", "student-b"])).rejects.toThrow();
  });
  const emptySummary = { event_count: 0, correct_reward: 0, wrong_effect: 0, net_change: 0, current_points: 0 };
  it.each([null, [], {}, [null], [emptySummary, emptySummary]])("요약은 유효한 한 행이어야 한다: %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getStudentAttemptPointSummary("student-a", "attempt-a")).rejects.toThrow();
    await expect(getAdminAttemptPointSummary("student-a", "attempt-a")).rejects.toThrow();
  });
  it.each(["event_count", "correct_reward", "wrong_effect", "net_change", "current_points"])(
    "사건0에서도 %s를 빠짐없이 검증한다", async field => {
      for (const value of [null, undefined, "", false, [], "bad"]) {
        mocks.rpc.mockResolvedValue({ data: [{ ...emptySummary, [field]: value }], error: null });
        await expect(getStudentAttemptPointSummary("student-a", "attempt-a")).rejects.toThrow();
      }
    },
  );
  it.each([
    { event_count: -1 }, { correct_reward: -1, net_change: -1 }, { wrong_effect: 1, net_change: 1 }, { current_points: -1 },
    { event_count: 1, correct_reward: 2, wrong_effect: -1, net_change: 2 },
    { correct_reward: 2, wrong_effect: -2 }, { correct_reward: 2, net_change: 2 },
  ])("요약 부호·합산·사건수 모순은 거절한다: %j", async patch => {
    mocks.rpc.mockResolvedValue({ data: [{ ...emptySummary, ...patch }], error: null });
    await expect(getAdminAttemptPointSummary("student-a", "attempt-a")).rejects.toThrow();
  });
  it("정수 문자열과 안전 정수 경계의 실제0/순변화0을 보존한다", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ student_id: "student-a", current_points: String(Number.MAX_SAFE_INTEGER) }], error: null });
    expect(await getStudentPointBalance("student-a")).toBe(Number.MAX_SAFE_INTEGER);
    mocks.rpc.mockResolvedValue({ data: [{ event_count: "2", correct_reward: "2", wrong_effect: "-2", net_change: "0", current_points: "0" }], error: null });
    expect(await getStudentAttemptPointSummary("student-a", "attempt-a")).toEqual({ attemptPoints: 0, currentPoints: 0 });
    expect(await getAdminAttemptPointSummary("student-a", "attempt-a")).toEqual({ correctReward: 2, wrongEffect: -2, netChange: 0, currentPoints: 0 });
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
