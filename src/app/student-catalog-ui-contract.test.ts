import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student catalog and modal UI contract", () => {
  const css = source("src/app/globals.css");
  const studentManager = source("src/components/student-manager.tsx");
  const bulkDialog = source("src/components/bulk-assignment-dialog.tsx");

  it("keeps card tags content-sized and marks the active tab", () => {
    expect(css).toMatch(
      /\.student-card-info-row > \.meta-tag\s*\{[^}]*width:\s*fit-content;[^}]*justify-self:\s*start;/,
    );
    expect(css).toMatch(
      /\.student-detail-dialog > \.dialog-tabs\s*\{[^}]*border-radius:\s*0;/,
    );
    expect(css).toMatch(
      /\.student-detail-dialog > \.dialog-tabs > \.dialog-tab\[aria-selected="true"\]\s*\{[^}]*border-bottom-color:\s*var\(--card\);[^}]*color:\s*var\(--pass\);/,
    );
  });

  it("animates every modal tab while respecting reduced motion", () => {
    expect(studentManager).toContain('key="learning"');
    expect(studentManager).toContain('key="account"');
    expect(studentManager).toContain('key="history"');
    expect(css).toContain(
      "animation: student-tab-panel-in var(--motion-standard) both;",
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.student-dialog-panel,/,
    );
  });

  it("uses one named button size contract and compact bulk spacing", () => {
    expect(css).toContain("--control-height-small: 36px;");
    expect(css).toContain("--control-height-default: 44px;");
    expect(css).toContain("--control-height-large: 58px;");
    expect(css).toContain("--control-height-icon: 36px;");
    expect(css).toMatch(
      /\.button\.button-small\s*\{[^}]*height:\s*var\(--control-height-small\);/,
    );
    expect(css).toMatch(
      /\.button\.button-icon\s*\{[^}]*width:\s*var\(--control-height-icon\);/,
    );
    expect(css).toMatch(
      /\.bulk-assignment-form\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;/,
    );
    expect(css).toMatch(
      /\.bulk-assignment-form > \.dialog-actions\s*\{[^}]*margin-top:\s*0;/,
    );
    expect(bulkDialog).toContain('import { Button } from "@/components/ui-button";');
    expect(bulkDialog).toContain('size="small"');
  });

  it("uses structured groups and preserves learned wordbooks", () => {
    expect(studentManager).toContain("groupCataloguedDatasets");
    expect(studentManager).toContain("<optgroup");
    expect(studentManager).toContain("최근 단어장");
    expect(studentManager).toContain("StudentVocabBookHistoryList");
    expect(source("src/components/student-vocab-book-history-list.tsx")).toContain(
      "학습한 단어장",
    );
  });
});
