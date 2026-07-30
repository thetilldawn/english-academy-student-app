import { describe, expect, it } from "vitest";

import { getErrorReference } from "@/lib/observability/error-reference";

describe("getErrorReference", () => {
  it("turns a safe Next digest into the visible error number", () => {
    expect(getErrorReference({ digest: "1849320717" })).toBe(
      "next_1849320717",
    );
  });

  it("rejects missing or unsafe digests", () => {
    expect(getErrorReference(new Error("boom"))).toBeNull();
    expect(getErrorReference({ digest: "bad\nvalue" })).toBeNull();
  });
});
