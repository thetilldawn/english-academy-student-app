import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockReadError extends Error {}
  return {
    getStudentDashboardCompletedPage: vi.fn(),
    getStudentSession: vi.fn(),
    ReadError: MockReadError,
  };
});

vi.mock("@/lib/auth/student-session", () => ({
  getStudentSession: mocks.getStudentSession,
}));
vi.mock("@/features/student-dashboard/server/queries/student-dashboard-read-error", () => ({
  StudentDashboardReadError: mocks.ReadError,
}));
vi.mock("@/features/student-dashboard/server/queries/student-dashboard-query", () => ({
  getStudentDashboardCompletedPage: mocks.getStudentDashboardCompletedPage,
}));

import { StudentDashboardCursorError } from "@/features/student-dashboard/server/student-dashboard-cursor";
import { POST } from "./route";

const student = {
  studentId: "11111111-1111-4111-8111-111111111111",
};

function request(body: unknown, origin?: string) {
  return new Request("http://localhost/api/student/dashboard/completed", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    method: "POST",
  });
}

describe("POST /api/student/dashboard/completed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStudentSession.mockResolvedValue(student);
    mocks.getStudentDashboardCompletedPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it("현재 세션 학생의 완료 페이지만 private no-store로 반환한다", async () => {
    const response = await POST(request({ cursor: "opaque" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getStudentDashboardCompletedPage).toHaveBeenCalledWith(
      "opaque",
      student,
    );
  });

  it("비로그인, 다른 origin, 잘못된 본문에서는 조회하지 않는다", async () => {
    mocks.getStudentSession.mockResolvedValueOnce(null);
    expect((await POST(request({ cursor: "opaque" }))).status).toBe(401);
    expect((await POST(request(
      { cursor: "opaque" },
      "https://attacker.example",
    ))).status).toBe(403);
    expect((await POST(request({ cursor: "" }))).status).toBe(400);
    expect(mocks.getStudentDashboardCompletedPage).not.toHaveBeenCalled();
  });

  it("커서 오류와 DB 조회 오류를 구분하고 모두 캐시하지 않는다", async () => {
    mocks.getStudentDashboardCompletedPage
      .mockRejectedValueOnce(new StudentDashboardCursorError())
      .mockRejectedValueOnce(new mocks.ReadError("DB 오류"));
    const cursorError = await POST(request({ cursor: "bad" }));
    const readError = await POST(request({ cursor: "bad" }));
    expect(cursorError.status).toBe(400);
    expect(readError.status).toBe(503);
    expect(cursorError.headers.get("cache-control")).toBe("private, no-store");
    expect(readError.headers.get("cache-control")).toBe("private, no-store");
  });
});

