import { describe, expect, it } from "vitest";
import { quizExpirationError, quizCommandErrorResponse } from "./quiz-command-error";

describe("safe expiry errors", () => {
  it.each(["57014", "40P01", "40001", "55P03"])("identifies aborted transaction %s", code => {
    expect(quizExpirationError({ code, message: "private SQL detail" })).toMatchObject({
      status: 503, payload: { retryable: true, outcome: "not_applied" },
    });
  });
  it.each(["practice_expire_too_early", "attempt_not_expired"])("classifies business conflict first: %s", message => {
    expect(quizExpirationError({ code: "40001", message })).toMatchObject({ status: 409, payload: { retryable: false } });
  });
  it.each([
    [{ code: "42501" }, 403], [{ message: "attempt_not_found" }, 404], [{ code: "XX000" }, 503],
  ])("preserves a safe status without leaking SQL", async (error, status) => {
    const response = quizCommandErrorResponse(quizExpirationError(error));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("private SQL");
  });
  it("does not classify a failure after the committed RPC as a rolled-back write", async () => {
    const response = quizCommandErrorResponse(new Error("queue failure 57014"));
    expect(await response.json()).toMatchObject({ retryable: false, outcome: "unknown" });
  });
});
