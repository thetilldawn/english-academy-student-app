import { describe, expect, it, vi } from "vitest";

import {
  APP_REQUEST_ID_HEADER,
  APP_REQUEST_DEADLINE_HEADER,
  appendServerTiming,
  createRequestId,
  formatServerTiming,
  logServerOperationTiming,
  readRequestDeadlineAt,
  readRequestId,
} from "./request-timing";

describe("server request timing", () => {
  it("Vercel 요청 식별자를 안전하게 전달하고 없으면 새로 만든다", () => {
    const forwarded = createRequestId(new Headers({
      "x-vercel-id": "icn1::unsafe value",
    }));
    expect(forwarded).toBe("icn1::unsafe_value");

    const generated = createRequestId(new Headers());
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(readRequestId(new Headers({
      [APP_REQUEST_ID_HEADER]: forwarded,
    }))).toBe(forwarded);
    expect(readRequestDeadlineAt(new Headers({
      [APP_REQUEST_DEADLINE_HEADER]: "1788163207000",
    }))).toBe(1_788_163_207_000);
  });

  it("빠른 성공은 기록하지 않고 느린 요청은 구조화해 기록한다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logServerOperationTiming({
      durationMs: 20,
      operation: "history.read",
      outcome: "success",
    });
    expect(warn).not.toHaveBeenCalled();

    logServerOperationTiming({
      durationMs: 1_250.34,
      operation: "history.read",
      outcome: "success",
      requestId: "request-1",
    });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      durationMs: 1_250.3,
      operation: "history.read",
      outcome: "success",
      requestId: "request-1",
    });
    expect(formatServerTiming("admin.proxy auth", 12.34)).toBe(
      "admin_proxy_auth;dur=12.3",
    );
    const headers = new Headers({ "Server-Timing": "existing;dur=1" });
    appendServerTiming(headers, "admin_proxy_auth;dur=12.3");
    expect(headers.get("server-timing")).toBe(
      "existing;dur=1, admin_proxy_auth;dur=12.3",
    );
    warn.mockRestore();
  });
});
