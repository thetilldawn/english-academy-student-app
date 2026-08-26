import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    delete: mocks.cookieDelete,
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  }),
}));

vi.mock("@/lib/env", () => ({
  getStudentSessionEnvironment: () => ({
    STUDENT_SESSION_PEPPER: "preview-test-pepper",
  }),
}));

vi.mock("@/lib/auth/student-code", () => ({
  generateStudentSessionToken: () => "issued-token",
  getStudentCookieName: () => "student-session-test",
  getStudentCookieOptions: (expires: Date) => ({ expires, httpOnly: true }),
  hashStudentSessionToken: () => "A".repeat(64),
}));

vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({ rpc: mocks.rpc }),
}));

import { renewCurrentStudentSession } from "./student-session-command";

const expiresAt = "2026-10-25T03:00:00.000Z";
const serverNow = "2026-08-26T03:00:00.000Z";
const renewAfter = "2026-08-27T03:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieGet.mockReturnValue({ value: "current-token" });
});

describe("renewCurrentStudentSession", () => {
  it("DB가 이미 갱신된 정상 응답도 같은 만료일로 쿠키를 다시 맞춘다", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        session_id: "11111111-1111-4111-8111-111111111111",
        expires_at: expiresAt,
        renew_after: renewAfter,
        server_now: serverNow,
        renewed: false,
      }],
      error: null,
    });

    await expect(renewCurrentStudentSession()).resolves.toEqual({
      status: "unchanged",
      expiresAt,
      nextCheckInMilliseconds: 24 * 60 * 60 * 1000,
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "student-session-test",
      "current-token",
      { expires: new Date(expiresAt), httpOnly: true },
    );
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it("DB 오류는 쿠키를 바꾸지 않고 상위 경로가 503으로 처리하게 한다", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "temporary failure" },
    });

    await expect(renewCurrentStudentSession()).rejects.toThrow(
      "학생 세션을 갱신하지 못했습니다.",
    );
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it("유효한 세션 행이 없으면 쿠키를 삭제하고 무효 결과를 반환한다", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(renewCurrentStudentSession()).resolves.toEqual({
      status: "invalid",
    });
    expect(mocks.cookieDelete).toHaveBeenCalledWith("student-session-test");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
