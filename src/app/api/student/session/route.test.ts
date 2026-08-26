import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  renew: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/auth/student-session", () => ({
  getStudentSession: mocks.getSession,
  renewCurrentStudentSession: mocks.renew,
  revokeCurrentStudentSession: mocks.revoke,
}));

vi.mock("@/lib/http", () => ({
  isSameOriginRequest: () => true,
  parseJson: vi.fn(),
}));

vi.mock("@/lib/services/student-login-service", () => ({
  authenticateStudentCode: vi.fn(),
}));

import { GET, PATCH } from "./route";

const request = () => new Request("https://preview.test/api/student/session", {
  method: "PATCH",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("student session route", () => {
  it("정상 세션 조회도 개인 응답으로 캐시하지 않는다", async () => {
    mocks.getSession.mockResolvedValue({
      sessionId: "11111111-1111-4111-8111-111111111111",
      studentId: "22222222-2222-4222-8222-222222222222",
      displayName: "검증 학생",
      schoolName: null,
      gradeLabel: null,
      expiresAt: "2026-10-25T03:00:00.000Z",
      lastSeenAt: "2026-08-26T03:00:00.000Z",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("무효 세션은 401로 반환한다", async () => {
    mocks.renew.mockResolvedValue({ status: "invalid" });

    const response = await PATCH(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("일시적인 갱신 오류는 쿠키 삭제를 지시하지 않고 503으로 반환한다", async () => {
    mocks.renew.mockRejectedValue(new Error("temporary failure"));

    const response = await PATCH(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
