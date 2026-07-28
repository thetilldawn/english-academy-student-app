export const STUDENT_CODE_LENGTH = 12;

const STUDENT_CODE_CHARACTERS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export function normalizeStudentCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(STUDENT_CODE_CHARACTERS, "")
    .slice(0, STUDENT_CODE_LENGTH);
}
