import { describe, expect, it, vi } from "vitest";

import {
  buildServerErrorEvent,
  logServerError,
  redactLogText,
  ServerOperationError,
} from "@/lib/observability/server-log";

describe("server error logging", () => {
  it("keeps diagnostic fields and removes private values", () => {
    const cause = {
      code: "PGRST202",
      message:
        "student 7e906f8d-4b37-4b60-96c4-107b1e6fdb80 failed for a@b.com",
      details: "Key (student_id)=(7e906f8d-4b37-4b60-96c4-107b1e6fdb80)",
      hint: "code='AB12-CD34'",
    };
    const error = new ServerOperationError(
      "시간이 지난 시험을 확정하지 못했습니다.",
      {
        operation: "quiz.stale.finalize",
        code: "STALE_ATTEMPT_FINALIZE_FAILED",
        cause,
      },
    );

    const event = buildServerErrorEvent({
      event: "request.failed",
      error,
      route: "/admin/results",
      method: "GET",
      errorId: "next_12345",
    });
    const serialized = JSON.stringify(event);

    expect(event.operation).toBe("quiz.stale.finalize");
    expect(event.code).toBe("STALE_ATTEMPT_FINALIZE_FAILED");
    expect(event.supabase?.code).toBe("PGRST202");
    expect(event.errorId).toBe("next_12345");
    expect(serialized).not.toContain(
      "7e906f8d-4b37-4b60-96c4-107b1e6fdb80",
    );
    expect(serialized).not.toContain("a@b.com");
    expect(serialized).not.toContain("AB12-CD34");
  });

  it("redacts secret keys and quoted detail values", () => {
    expect(
      redactLogText(
        `token=${"sb_" + "secret_example"} Key (email)=(person@example.com) reason='private'`,
        { strong: true },
      ),
    ).toBe(
      "token=[redacted-key] Key (email)=([redacted]) reason='[redacted]'",
    );
  });

  it("writes exactly one JSON log entry", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logServerError({
      event: "request.failed",
      error: new Error("boom"),
      route: "/admin",
      method: "GET",
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(() =>
      JSON.parse(String(consoleError.mock.calls[0]?.[0])),
    ).not.toThrow();
    consoleError.mockRestore();
  });

  it("does not copy an unclassified error message into structured logs", () => {
    const event = buildServerErrorEvent({
      event: "request.failed",
      error: new Error("student 윤서정 failed"),
    });

    expect(event.error.message).toBe("Unhandled server error");
    expect(JSON.stringify(event)).not.toContain("윤서정");
  });
});
