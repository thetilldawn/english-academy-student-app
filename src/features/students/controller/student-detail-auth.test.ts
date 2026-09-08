import { afterEach, describe, expect, it, vi } from "vitest";
const signal = vi.hoisted(() => vi.fn());
vi.mock("@/features/session/public-client", () => ({ announceAdminPrivateCacheChange: signal }));
import { revealStudentCode } from "../api/student-mutations";
import { loadStudentHistoryInitial } from "../transport/student-history-pages";
import { emptyStudentHistoryFilters } from "../contracts/student-detail-read-model";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("학생 상세 인증 실패 신호", () => {
  it("취소된 옛 내역 조회의 늦은 인증 오류로 현재 화면을 잠그지 않는다", async () => {
    const abort = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { abort.abort(); return new Response(null, { status: 401 }); }));
    await expect(loadStudentHistoryInitial("fake", { mode: "initial", filters: emptyStudentHistoryFilters }, abort.signal)).rejects.toThrow();
    expect(signal).not.toHaveBeenCalled();
  });
  it.each([401, 403])("내역과 코드 %s는 개인 자료 잠금으로 연결한다", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private upstream", { status })));
    await expect(revealStudentCode("fake")).rejects.toThrow("관리자 로그인이 필요합니다.");
    await expect(loadStudentHistoryInitial("fake", { mode: "initial", filters: emptyStudentHistoryFilters })).rejects.toThrow("관리자 로그인이 필요합니다.");
    expect(signal).toHaveBeenCalledTimes(2);
    expect(signal).toHaveBeenCalledWith("identity");
  });
  it("503 조회 장애는 로그아웃으로 취급하지 않고 내부 내용을 표시하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "private upstream" }, { status: 503 })));
    await expect(loadStudentHistoryInitial("fake", { mode: "initial", filters: emptyStudentHistoryFilters })).rejects.toThrow("학생 시험 내역을 불러오지 못했습니다.");
    expect(signal).not.toHaveBeenCalled();
  });
});
