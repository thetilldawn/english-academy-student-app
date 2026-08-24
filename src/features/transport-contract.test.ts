import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelStudentAssignment,
  hideAdminHistoryEntry,
} from "@/features/history/api/history-mutations";
import { requestNotificationDelivery } from "@/features/notifications/api/notification-delivery";
import {
  requestAdminLogin,
  requestStudentLogout,
} from "@/features/session/api/session";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser transport contracts", () => {
  it("keeps a successful empty login response successful", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(
      requestAdminLogin({ email: "admin@example.com", password: "secret" }, signal),
    ).resolves.toStrictEqual({ error: undefined, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/session",
      expect.objectContaining({ method: "POST", signal }),
    );
  });

  it("preserves a structured login failure and logout result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "로그인 실패" }, { status: 401 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestAdminLogin(
        { email: "admin@example.com", password: "wrong" },
        new AbortController().signal,
      ),
    ).resolves.toStrictEqual({ error: "로그인 실패", ok: false });
    await expect(requestStudentLogout()).resolves.toBe(true);
  });

  it("uses API errors when present and fallback errors otherwise", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "취소할 수 없습니다" }, { status: 409 }),
      )
      .mockResolvedValueOnce(new Response("not-json", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cancelStudentAssignment("assignment", "student", "취소 실패"),
    ).rejects.toThrow("취소할 수 없습니다");
    await expect(
      hideAdminHistoryEntry(
        { assignmentId: "assignment", studentId: "student", attemptId: null },
        "내역 숨기기 실패",
      ),
    ).rejects.toThrow("내역 숨기기 실패");
  });

  it("accepts only a valid successful notification payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ newAssignmentCount: 2, deadlineSoonCount: 1 }),
      )
      .mockResolvedValueOnce(Response.json({ newAssignmentCount: -1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestNotificationDelivery("student")).resolves.toStrictEqual({
      newAssignmentCount: 2,
      deadlineSoonCount: 1,
    });
    await expect(requestNotificationDelivery("admin")).resolves.toBeNull();
  });
});
