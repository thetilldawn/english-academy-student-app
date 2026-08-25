import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("React Server Component request cache runtime", () => {
  it("deduplicates within one render and resets for the next render", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        path.resolve("scripts/verify-react-request-cache.mjs"),
      ],
      { encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "ok", calls: 2 });
  });
});
