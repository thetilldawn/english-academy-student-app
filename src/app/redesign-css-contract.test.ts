import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = fs.readFileSync(
  path.resolve("src/app/globals.css"),
  "utf8",
);

describe("redesign CSS contract", () => {
  it("keeps literal colors inside token blocks", () => {
    const withoutTokenBlocks = css.replace(/:root\s*\{[\s\S]*?\}/g, "");
    expect(withoutTokenBlocks).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("uses a compact radius scale", () => {
    const values = new Set(
      [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((match) =>
        match[1].trim(),
      ),
    );
    expect(values.size).toBeLessThanOrEqual(5);
  });

  it("does not restore decorative effects", () => {
    expect(css).not.toMatch(
      /(?:linear-gradient|radial-gradient|backdrop-filter|box-shadow)\s*:/,
    );
  });

  it("uses only the approved font weights", () => {
    const weights = new Set(
      [...css.matchAll(/font-weight:\s*(\d+);/g)].map((match) =>
        Number(match[1]),
      ),
    );
    expect([...weights].sort()).toEqual([400, 600, 700]);
  });

  it("renders quiz choices as one vertical column", () => {
    expect(css).toMatch(
      /\.choice-list\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    );
  });
});
