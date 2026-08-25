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
});
