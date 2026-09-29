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

import { StudentDashboardCursorError, assertStudentDashboardCursorOwner, studentDashboardStudentFingerprint } from "@/features/student-dashboard/server/student-dashboard-cursor";
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

  it("학생A 화면의 커서를 학생B 세션으로 쓰면 일반400이 아닌409로 분리한다", async () => {
    mocks.getStudentSession.mockResolvedValue({ studentId: "33333333-3333-4333-8333-333333333333" });
    mocks.getStudentDashboardCompletedPage.mockImplementation(async (_cursor, current) => {
      assertStudentDashboardCursorOwner({ assignmentId: "22222222-2222-4222-8222-222222222222", effectiveAt: "2026-08-28T00:00:00.000Z", snapshotAt: "2026-08-29T00:00:00.000Z", studentFingerprint: studentDashboardStudentFingerprint(student.studentId), version: 1 }, current.studentId);
      throw new Error("불일치 뒤 조회하면 안 됨");
    });
    const response = await POST(request({ cursor: "student-a-cursor" }));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "학생 정보가 바뀌었습니다. 첫 화면부터 다시 확인해 주세요." });
  });
});

