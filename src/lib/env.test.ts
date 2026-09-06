import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppConfigurationError,
  getAdminListCachePolicy,
  getAppOrigin,
  getStudentCodeEnvironment,
} from "@/lib/env";

const key32 = Buffer.alloc(32, 7).toString("base64");

describe("기능별 서버 환경설정 계약", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, "", "  ", "1", " 1 "])("목록 캐시는 미설정·공백·1이면 켠다: %s", (value) => {
    vi.stubEnv("STUDENT_DIRECTORY_CACHE_CANARY", value);
    vi.stubEnv("ASSIGNMENT_DIRECTORY_CACHE_CANARY", value);
    vi.stubEnv("HISTORY_LIST_CACHE_CANARY", value);
    expect(getAdminListCachePolicy()).toEqual({ students: true, assignments: true, history: true });
  });

  it.each(["0", " 0 ", "true", "false", "2", "invalid"])("목록 캐시는 0·잘못된 설정이면 끈다: %s", (value) => {
    vi.stubEnv("STUDENT_DIRECTORY_CACHE_CANARY", value);
    vi.stubEnv("ASSIGNMENT_DIRECTORY_CACHE_CANARY", value);
    vi.stubEnv("HISTORY_LIST_CACHE_CANARY", value);
    expect(getAdminListCachePolicy()).toEqual({ students: false, assignments: false, history: false });
  });

  it.each(Array.from({ length: 8 }, (_, index) => ({
    students: Boolean(index & 4), assignments: Boolean(index & 2), history: Boolean(index & 1),
  })))("학생 캐시가 꺼지면 배정만 함께 끄고 내역은 독립이다: %j", (flags) => {
    vi.stubEnv("STUDENT_DIRECTORY_CACHE_CANARY", flags.students ? "1" : "0");
    vi.stubEnv("ASSIGNMENT_DIRECTORY_CACHE_CANARY", flags.assignments ? "1" : "0");
    vi.stubEnv("HISTORY_LIST_CACHE_CANARY", flags.history ? "1" : "0");
    expect(getAdminListCachePolicy()).toEqual({
      ...flags, assignments: flags.students && flags.assignments,
    });
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

  it("학생 조회 화면은 코드·세션 비밀값 없이 앱 주소만 읽는다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://preview.example.com");
    vi.stubEnv("STUDENT_CODE_PEPPER", "");
    vi.stubEnv("STUDENT_SESSION_PEPPER", "");
    vi.stubEnv("STUDENT_CODE_ENCRYPTION_KEY", "");
    vi.stubEnv("LOGIN_IP_PEPPER", "");

    expect(getAppOrigin()).toBe("https://preview.example.com");
  });

  it("Preview 주소 설정이 없으면 현재 Vercel 배포 주소를 사용한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("VERCEL_URL", "preview.example.vercel.app");

    expect(getAppOrigin()).toBe("https://preview.example.vercel.app");
  });

  it("운영환경은 Vercel 배포 주소로 APP_ORIGIN을 대신하지 않는다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("VERCEL_URL", "production.example.vercel.app");

    expect(() => getAppOrigin()).toThrow(AppConfigurationError);
  });

  it("운영 앱 주소가 잘못되면 설정 오류로 중단한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "not-a-url");

    expect(() => getAppOrigin()).toThrow(AppConfigurationError);
  });
});
