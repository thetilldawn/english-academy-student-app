import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("UI architecture debt ratchet", () => {
  it("reports file size without enforcing an arbitrary line ceiling", () => {
    const source = fs.readFileSync(
      path.resolve("scripts/verify-ui-architecture.mjs"),
      "utf8",
    );

    expect(source).not.toContain("maxLines");
    expect(source).not.toMatch(/exceeds the \d+ line/);
    expect(source).not.toMatch(/lineCount\(source\)\s*>/);
    expect(source).not.toMatch(/^\s*lines:\s*\d+/m);
    expect(source).toContain("lines: lineCount(source)");
  });

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
