import { describe, expect, it } from "vitest";
import { assignmentReleaseNotice, assignmentReleaseSchema, assignmentReleaseStartError, isAssignmentReleaseOpen } from "./assignment-release";

describe("서버 공개 상태 계약", () => {
  it("알 수 없는 상태와 시각 없는 시간대기를 허용하지 않는다", () => {
    expect(assignmentReleaseSchema.safeParse({ state: "maybe", opensAt: null, hasDeadline: false }).success).toBe(false);
    expect(assignmentReleaseSchema.safeParse({ state: "waiting_time", opensAt: null, hasDeadline: true }).success).toBe(false);
  });
  it("보류와 정상 첫 시험 대기는 오류·완료·즉시 공개로 표시하지 않는다", () => {
    expect(assignmentReleaseNotice({ state: "held", opensAt: null, hasDeadline: false })).toContain("보류");
    expect(assignmentReleaseNotice({ state: "waiting_initial", opensAt: null, hasDeadline: true })).toContain("12시간");
    expect(isAssignmentReleaseOpen({ state: "waiting_initial", opensAt: null, hasDeadline: false })).toBe(false);
    expect(isAssignmentReleaseOpen({ state: "open", opensAt: null, hasDeadline: false })).toBe(true);
  });
  it("알려진 DB 거절만 쉬운 안내로 바꾸며 임의 내부 오류는 전달하지 않는다", () => {
    expect(assignmentReleaseStartError("assignment_release_held")).toContain("보류");
    expect(assignmentReleaseStartError("assignment_release_cancelled")).toContain("취소");
    expect(assignmentReleaseStartError("password SQL internal")).toBeNull();
  });
});
