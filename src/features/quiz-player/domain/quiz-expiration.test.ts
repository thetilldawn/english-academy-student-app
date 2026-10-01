import { describe, expect, it } from "vitest";
import { canRetryQuizExpiration } from "./quiz-expiration";

describe("expiry retry permission", () => {
  it.each([
    [{ ok: true }, false],
    [{ ok: false, payload: {} }, false],
    [{ ok: false, payload: { retryable: true, outcome: "unknown" } }, false],
    [{ ok: false, payload: { retryable: false, outcome: "not_applied" } }, false],
    [{ ok: false, payload: { retryable: true, outcome: "not_applied" } }, true],
  ] as const)("requires explicit transaction failure: %j", (response, expected) => {
    expect(canRetryQuizExpiration(response)).toBe(expected);
  });
});
