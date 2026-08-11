import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(path.resolve(relativePath), "utf8");
}

describe("history section spacing contract", () => {
  it("keeps section spacing separate from row spacing", () => {
    const sectionStyles = source(
      "src/features/history/ui/history-section-groups.module.css",
    );
    const listStyles = source(
      "src/features/history/ui/history-list.module.css",
    );

    expect(sectionStyles).toMatch(
      /\.groups\s*\{[\s\S]*?gap:\s*32px;/,
    );
    expect(sectionStyles).toMatch(
      /@media\s*\(min-width:\s*768px\)[\s\S]*?\.groups\s*\{[^}]*gap:\s*40px;/,
    );
    expect(listStyles).toMatch(
      /\.list\s*\{[\s\S]*?gap:\s*var\(--space-2\);/,
    );
  });
});
