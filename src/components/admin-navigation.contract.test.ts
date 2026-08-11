import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin navigation loading contract", () => {
  it("does not attach route loading indicators to individual nav labels", () => {
    const component = source("src/components/admin-navigation.tsx");
    const css = source("src/components/shell/admin-navigation.module.css");
    const pageLoading = source("src/app/admin/(protected)/loading.tsx");

    expect(component).not.toMatch(/useLinkStatus|ButtonSpinner|pending/);
    expect(css).not.toMatch(/\.pending\s*\{/);
    expect(css).toMatch(
      /\.mobile \.link\s*\{[^}]*padding:\s*6px;/,
    );
    expect(pageLoading).toContain('role="status"');
  });
});
