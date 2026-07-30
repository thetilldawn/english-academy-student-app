export const STUDENT_CODE_LENGTH = 12;

const STUDENT_CODE_CHARACTERS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export function normalizeStudentCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(STUDENT_CODE_CHARACTERS, "")
    .slice(0, STUDENT_CODE_LENGTH);
}

export function readStudentCodeHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = normalizeStudentCodeInput(params.get("code") ?? "");
  return code.length === STUDENT_CODE_LENGTH ? code : null;
}

export function buildStudentAccessUrl(
  origin: string,
  value: string,
): string {
  const code = normalizeStudentCodeInput(value);
  if (code.length !== STUDENT_CODE_LENGTH) {
    throw new Error("학생 접속코드가 올바르지 않습니다.");
  }

  const url = new URL("/", origin);
  url.hash = new URLSearchParams({ code }).toString();
  return url.toString();
}
