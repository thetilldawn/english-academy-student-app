import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAttemptQuestionResults: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/services/quiz/attempt-result-query", () => ({
  getAttemptQuestionResults: mocks.getAttemptQuestionResults,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

import { getAdminAttemptDetail } from "./admin-attempt-detail-query";

const admin = { displayName: "관리자", userId: "admin-id" };

describe("admin attempt detail read service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAttemptQuestionResults.mockResolvedValue([]);
  });

  it("DB 오류와 실제 미존재를 구분한다", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(getAdminAttemptDetail("attempt-id", admin)).rejects.toThrow(
      "응시 상세를 불러오지 못했습니다.",
    );
    await expect(getAdminAttemptDetail("attempt-id", admin)).resolves.toBeNull();
  });
});
