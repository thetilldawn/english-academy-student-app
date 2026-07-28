import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppConfigurationError,
  getStudentCodeEnvironment,
} from "@/lib/env";

const key32 = Buffer.alloc(32, 7).toString("base64");

describe("기능별 서버 환경설정 계약", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("학생 생성은 코드 생성에 필요한 두 비밀값만 검사한다", () => {
    vi.stubEnv("STUDENT_CODE_PEPPER", key32);
    vi.stubEnv("STUDENT_CODE_ENCRYPTION_KEY", key32);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("STUDENT_SESSION_PEPPER", "");
    vi.stubEnv("LOGIN_IP_PEPPER", "");
    vi.stubEnv("APP_ORIGIN", "");

    expect(getStudentCodeEnvironment()).toEqual({
      STUDENT_CODE_PEPPER: key32,
      STUDENT_CODE_ENCRYPTION_KEY: key32,
    });
  });

  it("학생코드 비밀값이 올바르지 않으면 설정 오류로 중단한다", () => {
    vi.stubEnv("STUDENT_CODE_PEPPER", "invalid");
    vi.stubEnv("STUDENT_CODE_ENCRYPTION_KEY", key32);

    expect(() => getStudentCodeEnvironment()).toThrow(
      AppConfigurationError,
    );
  });

  it("32바이트로 디코딩되더라도 비정상 base64 문자가 있으면 거절한다", () => {
    vi.stubEnv("STUDENT_CODE_PEPPER", `${"A".repeat(43)}!`);
    vi.stubEnv("STUDENT_CODE_ENCRYPTION_KEY", key32);

    expect(() => getStudentCodeEnvironment()).toThrow(
      AppConfigurationError,
    );
  });
});
