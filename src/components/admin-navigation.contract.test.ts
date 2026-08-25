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
    const assignmentCss = source(
      "src/features/assignments/ui/assignment-workspace.module.css",
    );
    const assignmentEditorCss = source(
      "src/features/assignments/ui/single-assignment-editor.module.css",
    );
    const tokens = source("src/styles/tokens.css");
    const pageLoading = source("src/app/admin/(protected)/loading.tsx");

    expect(component).not.toMatch(/useLinkStatus|ButtonSpinner|pending/);
    expect(css).not.toMatch(/\.pending\s*\{/);
    expect(css).toMatch(
      /\.mobile \.link\s*\{[^}]*padding:\s*6px;/,
    );
    expect(tokens).toContain("--admin-mobile-nav-height: 65px");
    expect(css).toContain("var(--admin-mobile-nav-height)");
    expect(assignmentCss).toContain("var(--admin-mobile-nav-height)");
    expect(assignmentEditorCss).toMatch(
      /@media \(max-width: 767px\) \{\s*\.inlineFooter \{\s*bottom: calc\(var\(--admin-mobile-nav-height\) \+ env\(safe-area-inset-bottom\)\);/,
    );
    expect(assignmentCss).not.toContain("72px");
    expect(pageLoading).toContain('role="status"');
  });
});
