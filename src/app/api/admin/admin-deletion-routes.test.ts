import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAdminDeletionError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "not_found"
        | "in_progress"
        | "conflict"
        | "database",
      message = "삭제 오류",
    ) {
      super(message);
    }
  }

  return {
    getAdminContext: vi.fn(),
    deleteStudent: vi.fn(),
    deleteAssignment: vi.fn(),
    hideAdminHistoryEntry: vi.fn(),
    AdminDeletionError: MockAdminDeletionError,
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));

vi.mock("@/lib/services/admin-deletion-service", () => ({
  deleteStudent: mocks.deleteStudent,
  deleteAssignment: mocks.deleteAssignment,
  hideAdminHistoryEntry: mocks.hideAdminHistoryEntry,
  AdminDeletionError: mocks.AdminDeletionError,
}));

import { DELETE as deleteAssignmentRoute } from "@/app/api/admin/assignments/[assignmentId]/route";
import { DELETE as deleteHistoryRoute } from "@/app/api/admin/history/route";
import { DELETE as deleteStudentRoute } from "@/app/api/admin/students/[id]/route";

const studentId = "11111111-1111-4111-8111-111111111111";
const assignmentId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const admin = { userId: "admin-id" };

function request(
  path: string,
  body?: unknown,
  origin?: string,
) {
  return new Request(`http://localhost${path}`, {
    method: "DELETE",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("admin deletion routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue(admin);
    mocks.deleteStudent.mockResolvedValue({
      status: "deleted",
      studentId,
    });
    mocks.deleteAssignment.mockResolvedValue({
      status: "deleted",
      assignmentId,
    });
    mocks.hideAdminHistoryEntry.mockResolvedValue({
      status: "hidden",
      assignmentId,
      studentId,
      attemptId,
    });
  });

  it("학생 DELETE를 same-origin 관리자에게만 허용한다", async () => {
    const response = await deleteStudentRoute(
      request(`/api/admin/students/${studentId}`),
      { params: Promise.resolve({ id: studentId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(mocks.deleteStudent).toHaveBeenCalledWith(
      studentId,
      admin,
    );

    const blocked = await deleteStudentRoute(
      request(
        `/api/admin/students/${studentId}`,
        undefined,
        "https://attacker.example",
      ),
      { params: Promise.resolve({ id: studentId }) },
    );
    expect(blocked.status).toBe(403);

    const invalid = await deleteStudentRoute(
      request("/api/admin/students/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(invalid.status).toBe(400);
    expect(mocks.deleteStudent).toHaveBeenCalledTimes(1);
  });

  it("시험 DELETE의 진행 중 충돌과 UUID 오류를 구분한다", async () => {
    mocks.deleteAssignment.mockRejectedValueOnce(
      new mocks.AdminDeletionError("in_progress"),
    );
    const conflict = await deleteAssignmentRoute(
      request(`/api/admin/assignments/${assignmentId}`),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(conflict.status).toBe(409);

    const invalid = await deleteAssignmentRoute(
      request("/api/admin/assignments/not-a-uuid"),
      { params: Promise.resolve({ assignmentId: "not-a-uuid" }) },
    );
    expect(invalid.status).toBe(400);
    expect(mocks.deleteAssignment).toHaveBeenCalledTimes(1);
  });

  it("시험 DELETE 성공과 찾을 수 없음 응답을 구분한다", async () => {
    const success = await deleteAssignmentRoute(
      request(`/api/admin/assignments/${assignmentId}`),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe(
      "private, no-store",
    );

    mocks.deleteAssignment.mockRejectedValueOnce(
      new mocks.AdminDeletionError("not_found"),
    );
    const missing = await deleteAssignmentRoute(
      request(`/api/admin/assignments/${assignmentId}`),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(missing.status).toBe(404);
  });

  it("내역 DELETE는 서버가 검증한 세 식별자만 서비스에 전달한다", async () => {
    const input = { assignmentId, studentId, attemptId };
    const response = await deleteHistoryRoute(
      request("/api/admin/history", input),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(mocks.hideAdminHistoryEntry).toHaveBeenCalledWith(
      input,
      admin,
    );

    const invalid = await deleteHistoryRoute(
      request("/api/admin/history", {
        ...input,
        tableName: "quiz_attempts",
      }),
    );
    expect(invalid.status).toBe(400);

    mocks.hideAdminHistoryEntry.mockResolvedValueOnce({
      status: "hidden",
      assignmentId,
      studentId,
      attemptId: null,
    });
    const recipientOnly = await deleteHistoryRoute(
      request("/api/admin/history", {
        assignmentId,
        studentId,
        attemptId: null,
      }),
    );
    expect(recipientOnly.status).toBe(200);
    expect(mocks.hideAdminHistoryEntry).toHaveBeenLastCalledWith(
      { assignmentId, studentId, attemptId: null },
      admin,
    );
  });

  it("내역 DELETE의 다른 origin과 DB 오류를 구분한다", async () => {
    const blocked = await deleteHistoryRoute(
      request(
        "/api/admin/history",
        { assignmentId, studentId, attemptId },
        "https://attacker.example",
      ),
    );
    expect(blocked.status).toBe(403);
    expect(mocks.hideAdminHistoryEntry).not.toHaveBeenCalled();

    mocks.hideAdminHistoryEntry.mockRejectedValueOnce(
      new mocks.AdminDeletionError("database"),
    );
    const unavailable = await deleteHistoryRoute(
      request("/api/admin/history", {
        assignmentId,
        studentId,
        attemptId,
      }),
    );
    expect(unavailable.status).toBe(503);

    mocks.hideAdminHistoryEntry.mockRejectedValueOnce(
      new mocks.AdminDeletionError("conflict"),
    );
    const stale = await deleteHistoryRoute(
      request("/api/admin/history", {
        assignmentId,
        studentId,
        attemptId: null,
      }),
    );
    expect(stale.status).toBe(409);
  });

  it("세 mutation 모두 비로그인 요청에서 서비스를 호출하지 않는다", async () => {
    mocks.getAdminContext.mockResolvedValue(null);

    const responses = await Promise.all([
      deleteStudentRoute(
        request(`/api/admin/students/${studentId}`),
        { params: Promise.resolve({ id: studentId }) },
      ),
      deleteAssignmentRoute(
        request(`/api/admin/assignments/${assignmentId}`),
        { params: Promise.resolve({ assignmentId }) },
      ),
      deleteHistoryRoute(
        request("/api/admin/history", {
          assignmentId,
          studentId,
          attemptId: null,
        }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401,
    ]);
    expect(mocks.deleteStudent).not.toHaveBeenCalled();
    expect(mocks.deleteAssignment).not.toHaveBeenCalled();
    expect(mocks.hideAdminHistoryEntry).not.toHaveBeenCalled();
  });
});
