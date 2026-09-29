import { afterEach, describe, expect, it, vi } from "vitest";

import { loadStudentDashboardCompletedPage } from "./student-dashboard-pages";
import { StudentDashboardRequestError } from "../contracts/student-dashboard-request-error";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("상태는 보존하고 서버 내부 문구와 잘못된 성공 응답은 표시하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(
        Response.json({ error: "private database detail" }, { status: 400 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true })));

    await expect(loadStudentDashboardCompletedPage("bad"))
      .rejects.toMatchObject({ status: 400, message: "다음 시험 목록을 불러오지 못했습니다. 다시 시도해 주세요." });
    await expect(loadStudentDashboardCompletedPage("missing"))
      .rejects.toThrow("다음 시험 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
  });

  it.each([401, 403])("JSON이 아닌 %s도 실제 인증 거절로 전달한다", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>denied</html>", { status })));
    await expect(loadStudentDashboardCompletedPage("cursor")).rejects.toMatchObject({
      status, message: "로그인이 필요합니다. 접속 화면으로 이동합니다.",
    });
  });

  it.each([401, 403, 503])("%s의 본문이 멈춰도 상태 판정을 기다리지 않는다", async (status) => {
    const json = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json }));
    await expect(loadStudentDashboardCompletedPage("cursor")).rejects.toMatchObject({ status });
    expect(json).not.toHaveBeenCalled();
  });

  it("응답 본문도 요청 시간제한 안에 포함한다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: () => new Promise(() => undefined) }));
    const request = loadStudentDashboardCompletedPage("cursor");
    const assertion = expect(request).rejects.toBeInstanceOf(StudentDashboardRequestError);
    await vi.advanceTimersByTimeAsync(7001);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("상위 화면이 취소하면 본문을 기다리는 요청도 중단한다", async () => {
    const caller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: () => new Promise(() => undefined) }));
    const request = loadStudentDashboardCompletedPage("cursor", caller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    caller.abort();
    await assertion;
  });
});

