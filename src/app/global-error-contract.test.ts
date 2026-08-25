import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("global error document contract", () => {
  it("owns the minimum styles, font, document shell, and theme fallback", () => {
    const source = fs.readFileSync(path.resolve("src/app/global-error.tsx"), "utf8");

    expect(source).toContain('import "pretendard/dist/web/variable/pretendardvariable.css"');
    expect(source).toContain('import "@/styles/tokens.css"');
    expect(source).toContain('import "@/styles/theme.css"');
    expect(source).toContain('import "@/styles/reset.css"');
    expect(source).toContain('<html lang="ko">');
    expect(source).toContain("<body>");
    expect(source).toContain("document.documentElement.dataset.theme = theme");
  });
});
