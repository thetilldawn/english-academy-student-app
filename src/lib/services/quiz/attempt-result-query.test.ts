import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPointSummary: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/services/learning-point-read-service", () => ({
  getStudentAttemptPointSummary: mocks.getPointSummary,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({ from: mocks.from }),
}));

import { getAttemptResult } from "./attempt-result-query";

describe("getAttemptResult ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = {
      eq: vi.fn(),
      maybeSingle: mocks.maybeSingle,
      select: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mocks.from.mockReturnValue(chain);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it("does not read questions or points for another student's attempt", async () => {
    expect(
      await getAttemptResult("student-a", "attempt-owned-by-b"),
    ).toBeNull();

    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("quiz_attempts");
    expect(mocks.getPointSummary).not.toHaveBeenCalled();
  });

  it.each(["57014", "PGRST000"])("DB %s 장애를 없는 결과로 바꾸지 않는다", async (code) => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "private server detail" } });
    await expect(getAttemptResult("student-a", "attempt-a")).rejects.toThrow("시험 결과를 불러오지 못했습니다.");
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.getPointSummary).not.toHaveBeenCalled();
  });

  it("통신 예외도 404용 null로 삼키지 않는다", async () => {
    mocks.maybeSingle.mockRejectedValue(new Error("offline"));
    await expect(getAttemptResult("student-a", "attempt-a")).rejects.toThrow();
    expect(mocks.getPointSummary).not.toHaveBeenCalled();
  });
});
