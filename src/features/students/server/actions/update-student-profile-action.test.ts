import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ProfileError extends Error {
    constructor(
      public readonly reason: "conflict" | "database" | "unknown",
      message: string,
    ) {
      super(message);
    }
  }
  return {
    getAdminContext: vi.fn(),
    getSnapshot: vi.fn(),
    ProfileError,
    updateProfile: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({
  getAdminContextOrThrow: mocks.getAdminContext,
}));
vi.mock("@/lib/services/admin-student-command-service", () => ({
  getStudentProfileMutationSnapshot: mocks.getSnapshot,
  StudentProfileUpdateError: mocks.ProfileError,
  updateStudentProfile: mocks.updateProfile,
}));

import { readStudentProfileSaveResultAction, updateStudentProfileAction } from "./update-student-profile-action";

const studentId = "00000000-0000-4000-8000-000000000001";
const input = {
  baseVersion: "2026-08-31T00:00:00.000Z",
  displayName: "학생 A",
  gradeLabel: "고3",
  schoolName: "미리보기고",
  studentId,
};

describe("update student profile action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("인증 서버 장애는 미인증이 아니며 저장하지 않는다", async () => {
    mocks.getAdminContext.mockRejectedValueOnce(new Error("private auth error"));
    const result = await updateStudentProfileAction(input);
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(result)).not.toContain("private auth error");
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
  it("응답 유실은 저장 불명으로 반환하고 결과 확인은 읽기만 한다", async () => {
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.updateProfile.mockRejectedValueOnce(new mocks.ProfileError("unknown", "secret upstream"));
    expect(await updateStudentProfileAction(input)).toMatchObject({ ok: false, status: 503, outcome: "unknown" });
    mocks.getSnapshot.mockResolvedValue({ id: studentId, displayName: input.displayName, schoolName: input.schoolName, gradeLabel: input.gradeLabel, updatedAt: "2026-09-08T09:00:00.123456+09:00" });
    expect(await readStudentProfileSaveResultAction({ studentId })).toMatchObject({ ok: true, receipt: { version: "2026-09-08T09:00:00.123456+09:00" } });
    expect(mocks.updateProfile).toHaveBeenCalledTimes(1);
  });

  it("returns 401 without calling the command", async () => {
    mocks.getAdminContext.mockResolvedValue(null);
    await expect(updateStudentProfileAction(input)).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("returns the latest profile receipt on a version conflict", async () => {
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.updateProfile.mockRejectedValue(
      new mocks.ProfileError("conflict", "다른 변경이 먼저 저장됨"),
    );
    const current = {
      displayName: "서버 최신값",
      gradeLabel: "고3",
      id: studentId,
      schoolName: "미리보기고",
      updatedAt: "2026-08-31T00:01:00.000Z",
    };
    mocks.getSnapshot.mockResolvedValue(current);

    await expect(updateStudentProfileAction(input)).resolves.toMatchObject({
      current: {
        directoryEffect: "refresh-first-page",
        student: current,
        version: current.updatedAt,
      },
      ok: false,
      status: 409,
    });
  });
});
