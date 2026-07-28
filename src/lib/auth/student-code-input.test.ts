import { describe, expect, it } from "vitest";

import {
  normalizeStudentCodeInput,
  STUDENT_CODE_LENGTH,
} from "@/lib/auth/student-code-input";

describe("student code input", () => {
  it("하이픈·공백을 제거하고 소문자를 대문자로 바꾼다", () => {
    expect(normalizeStudentCodeInput("abcd-efgh-2345")).toBe(
      "ABCDEFGH2345",
    );
  });

  it("발급에 쓰지 않는 혼동 문자를 입력값에서 제외한다", () => {
    expect(normalizeStudentCodeInput("ABCI-O0L1-2345")).toBe("ABCL2345");
  });

  it("붙여넣은 값은 실제 코드 길이까지만 받는다", () => {
    const result = normalizeStudentCodeInput("ABCDEFGH2345XYZ");

    expect(result).toBe("ABCDEFGH2345");
    expect(result).toHaveLength(STUDENT_CODE_LENGTH);
  });
});
