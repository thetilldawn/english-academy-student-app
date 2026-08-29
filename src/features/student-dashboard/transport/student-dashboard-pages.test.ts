import { afterEach, describe, expect, it, vi } from "vitest";

import { loadStudentDashboardCompletedPage } from "./student-dashboard-pages";

afterEach(() => vi.unstubAllGlobals());

describe("student dashboard browser transport", () => {
  it("학생 ID 없이 커서만 POST로 보내고 취소 신호를 전달한다", async () => {
    const page = { items: [], nextCursor: null };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ page }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(loadStudentDashboardCompletedPage("cursor", signal))
      .resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/student/dashboard/completed",
      expect.objectContaining({
        body: JSON.stringify({ cursor: "cursor" }),
        cache: "no-store",
        method: "POST",
        signal,
      }),
    );
  });

  it("API 오류 문구와 잘못된 성공 응답을 구분한다", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(
        Response.json({ error: "커서 오류" }, { status: 400 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true })));

    await expect(loadStudentDashboardCompletedPage("bad"))
      .rejects.toThrow("커서 오류");
    await expect(loadStudentDashboardCompletedPage("missing"))
      .rejects.toThrow("다음 완료 시험을 불러오지 못했습니다.");
  });
});

