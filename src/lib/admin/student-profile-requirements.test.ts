import { expect, it } from "vitest";
import { hasRequiredStudentProfile, studentProfileFieldErrors } from "./student-profile-requirements";
const complete = { displayName: "가상 학생", schoolName: "가상고", gradeLabel: "고2" };
it.each(["displayName", "schoolName", "gradeLabel"] as const)("누락된 %s만 안내한다", field => {
  for (const value of [null, undefined, "", " \t\n\u00a0"]) {
    const profile = { ...complete, [field]: value };
    expect(hasRequiredStudentProfile(profile)).toBe(false);
    expect(Object.keys(studentProfileFieldErrors(profile))).toEqual([field]);
  }
});
it("공식 학교 연결키나 현재 단어장이 없어도 필수 정보가 있으면 배정 가능하다", () => {
  expect(hasRequiredStudentProfile(complete)).toBe(true);
  expect(studentProfileFieldErrors({})).toEqual({ displayName: "이름을 입력해 주세요.", schoolName: "학교를 입력해 주세요.", gradeLabel: "학년을 선택해 주세요." });
});
