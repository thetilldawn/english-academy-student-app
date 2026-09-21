export type RequiredStudentProfile = {
  displayName?: string | null;
  schoolName?: string | null;
  gradeLabel?: string | null;
};

export const STUDENT_PROFILE_REQUIRED_MESSAGE =
  "학생 정보에서 이름·학교·학년을 먼저 입력해 주세요.";

export function studentProfileFieldErrors(profile: RequiredStudentProfile) {
  const errors: Partial<Record<keyof RequiredStudentProfile, string>> = {};
  if (!profile.displayName?.trim()) errors.displayName = "이름을 입력해 주세요.";
  if (!profile.schoolName?.trim()) errors.schoolName = "학교를 입력해 주세요.";
  if (!profile.gradeLabel?.trim()) errors.gradeLabel = "학년을 선택해 주세요.";
  return errors;
}

export function hasRequiredStudentProfile(profile: RequiredStudentProfile) {
  return Object.keys(studentProfileFieldErrors(profile)).length === 0;
}
