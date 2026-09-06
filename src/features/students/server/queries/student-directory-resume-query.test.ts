import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ initial: vi.fn(), from: vi.fn(), select: vi.fn(), in: vi.fn(), is: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ from: mocks.from }) }));
vi.mock("./student-directory-query", () => ({ getStudentDirectoryInitial: mocks.initial }));
import { emptyStudentDirectoryFilters as filters } from "../../contracts/student-directory-read-model";
import { getStudentDirectoryCacheRead, studentDirectoryCacheIdentity } from "./student-directory-resume-query";
const id = "00000000-0000-4000-8000-000000000001";
const admin = { userId: "00000000-0000-4000-8000-000000000999", displayName: "가짜 관리자", sessionId: "fake-session" };
const input = { mode: "cache" as const, filters, identity: studentDirectoryCacheIdentity(admin)!, studentIds: [id] };
beforeEach(() => { vi.clearAllMocks(); mocks.from.mockReturnValue({ select: mocks.select }); mocks.select.mockReturnValue({ in: mocks.in }); mocks.in.mockReturnValue({ is: mocks.is }); mocks.initial.mockResolvedValue({ marker: "fresh" }); });
describe("학생 목록 재방문 현재 포인트", () => {
  it("현재 인증과 삭제 제외 조건으로만 조회한다", async () => {
    mocks.is.mockResolvedValue({ data: [{ id, student_point_totals: { total_points: "17" } }], error: null });
    expect(await getStudentDirectoryCacheRead(input, admin)).toMatchObject({ kind: "resume", points: [{ id, rawPoints: 17 }] });
    expect(mocks.from).toHaveBeenCalledWith("students"); expect(mocks.is).toHaveBeenCalledWith("deleted_at", null); expect(mocks.initial).not.toHaveBeenCalled();
  });
  it.each([null, []])("존재 학생의 집계 관계가 없을 때만 0: %j", async relation => {
    mocks.is.mockResolvedValue({ data: [{ id, student_point_totals: relation }], error: null });
    expect(await getStudentDirectoryCacheRead(input, admin)).toMatchObject({ points: [{ id, rawPoints: 0 }] });
  });
  it.each([null, "", false, 0.5])("잘못된 집계값을 0으로 바꾸지 않는다: %j", async total => {
    mocks.is.mockResolvedValue({ data: [{ id, student_point_totals: { total_points: total } }], error: null });
    await expect(getStudentDirectoryCacheRead(input, admin)).rejects.toThrow("응답");
  });
  it("삭제되거나 보이지 않는 학생은 첫 목록을 교체한다", async () => {
    mocks.is.mockResolvedValue({ data: [], error: null });
    expect(await getStudentDirectoryCacheRead(input, admin)).toMatchObject({ kind: "snapshot" });
    expect(mocks.initial).toHaveBeenCalledWith({ filters }, admin);
  });
  it("집계 실패를 빈 목록이나 0으로 바꾸지 않는다", async () => {
    mocks.is.mockResolvedValue({ data: null, error: { message: "private" } });
    await expect(getStudentDirectoryCacheRead(input, admin)).rejects.toThrow("확인하지 못");
  });
  it("세대 없거나 다른 세대는 캐시 복원을 하지 않는다", async () => {
    expect(await getStudentDirectoryCacheRead(input, { ...admin, sessionId: undefined })).toMatchObject({ kind: "snapshot", identity: null });
    expect(await getStudentDirectoryCacheRead(input, { ...admin, sessionId: "new-session" })).toMatchObject({ kind: "snapshot" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
