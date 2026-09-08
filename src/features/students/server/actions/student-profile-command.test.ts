import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/service", () => ({}));
import { updateStudentProfile } from "@/lib/services/admin-student-command-service";
const id = "00000000-0000-4000-8000-000000000001";
const version = "2026-09-08T09:00:00.123456+09:00";
const profile = { id, displayName: "가짜 학생", schoolName: null, gradeLabel: "고1", updatedAt: version };
const input = { baseVersion: version, displayName: "가짜 학생", schoolName: "", gradeLabel: "고1" };
const admin = { userId: "00000000-0000-4000-8000-000000000099", displayName: "가짜 관리자" };
beforeEach(() => vi.resetAllMocks());
describe("profile command response integrity", () => {
  it("서버 마이크로초 버전은 왕복 그대로 보존한다", async () => {
    mocks.rpc.mockResolvedValue({ data: profile, error: null, status: 200 });
    expect(await updateStudentProfile(id, input, admin)).toMatchObject({ version });
    expect(mocks.rpc).toHaveBeenCalledWith("update_admin_student_profile_v1", expect.objectContaining({ p_base_version: version }));
  });
  it.each([
    { data: null, error: { code: "", message: "fetch failed" }, status: 0 },
    { data: null, error: { code: "", message: "invalid json" }, status: 200 },
    { data: { ...profile, id: "00000000-0000-4000-8000-000000000002" }, error: null, status: 200 },
    { data: { ...profile, updatedAt: "invalid" }, error: null, status: 200 },
  ])("응답 유실/잘못된 성공은 저장 불명확이다 %#", async result => {
    mocks.rpc.mockResolvedValue(result);
    await expect(updateStudentProfile(id, input, admin)).rejects.toMatchObject({ reason: "unknown" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("실제 DB 충돌은 일반 장애와 구분한다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "student_profile_conflict" }, status: 409 });
    await expect(updateStudentProfile(id, input, admin)).rejects.toMatchObject({ reason: "conflict" });
  });
});
