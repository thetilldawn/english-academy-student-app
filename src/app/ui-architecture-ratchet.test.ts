import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("UI architecture debt ratchet", () => {
  it("does not let global CSS and legacy component debt grow", () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/verify-ui-architecture.mjs")],
      { encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "ok" });
  });
});
