import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptStudentCode,
  encryptStudentCode,
  formatStudentCode,
  generateStudentSessionToken,
  getStudentCookieOptions,
  hashStudentCode,
  hashStudentSessionToken,
  normalizeStudentCode,
} from "@/lib/auth/student-code";
import { STUDENT_SESSION_MAX_AGE_SECONDS } from "@/lib/constants";

const key = randomBytes(32).toString("base64");

describe("student code security", () => {
  it("공백과 하이픈에 상관없이 같은 HMAC을 만든다", () => {
    expect(hashStudentCode("ABCD-EFGH-2345", key)).toBe(
      hashStudentCode("abcd efgh 2345", key),
    );
    expect(normalizeStudentCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(formatStudentCode("abcdefgh2345")).toBe("ABCD-EFGH-2345");
  });

  it("코드를 AES-GCM으로 암호화해 관리자 재표시가 가능하다", () => {
    const encrypted = encryptStudentCode("ABCD-EFGH-2345", key);
    expect(encrypted.encryptedCode).not.toContain("ABCD");
    expect(decryptStudentCode(encrypted, key)).toBe("ABCD-EFGH-2345");
  });

  it("세션 토큰은 고엔트로피이며 해시만 저장할 수 있다", () => {
    const token = generateStudentSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashStudentSessionToken(token, key)).toMatch(/^[A-F0-9]{64}$/);
  });

  it("운영 쿠키는 180일·HttpOnly·SameSite=Lax를 사용한다", () => {
    const options = getStudentCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.maxAge).toBe(STUDENT_SESSION_MAX_AGE_SECONDS);
  });
});
