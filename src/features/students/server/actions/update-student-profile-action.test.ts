import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ProfileError extends Error {
    constructor(
      public readonly reason: "conflict" | "database",
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
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/services/admin-student-command-service", () => ({
  getStudentProfileMutationSnapshot: mocks.getSnapshot,
  StudentProfileUpdateError: mocks.ProfileError,
  updateStudentProfile: mocks.updateProfile,
}));

import { updateStudentProfileAction } from "./update-student-profile-action";

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
