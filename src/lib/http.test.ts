import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getClientAddress,
  isSameOriginRequest,
  privateJsonError,
} from "@/lib/http";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isSameOriginRequest", () => {
  it("운영환경에서 설정한 origin만 허용한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://study.example.com");

    expect(
      isSameOriginRequest(
        new Request("https://study.example.com/api/student/session", {
          method: "POST",
          headers: { origin: "https://study.example.com" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        new Request("https://study.example.com/api/student/session", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
  });

  it("운영환경에서 Origin이 없는 변경 요청은 차단한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      isSameOriginRequest(
        new Request("https://study.example.com/api/student/session", {
          method: "POST",
        }),
      ),
    ).toBe(false);
  });
});

describe("getClientAddress", () => {
  it("프록시가 덧붙인 마지막 전달 주소를 사용한다", () => {
    const request = new Request("https://study.example.com", {
      headers: {
        "x-forwarded-for": "198.51.100.4, 203.0.113.8",
      },
    });

    expect(getClientAddress(request)).toBe("203.0.113.8");
  });
});

describe("privateJsonError", () => {
  it("개인 API 오류도 브라우저·공유 캐시에 남기지 않는다", async () => {
    const response = privateJsonError("불러오기 실패", 503, {
      code: "read_failed",
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      code: "read_failed",
      error: "불러오기 실패",
    });
  });
});
