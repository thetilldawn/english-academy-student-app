import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student catalog and modal UI contract", () => {
  const css = source("src/app/globals.css");
  const resetCss = source("src/styles/reset.css");
  const tokens = source("src/styles/tokens.css");
  const buttonCss = source(
    "src/design-system/primitives/button/button.module.css",
  );
  const assignmentEditorCss = source(
    "src/components/assignment-editor-ui.module.css",
  );
  const badgeCss = source(
    "src/design-system/primitives/badge/badge.module.css",
  );
  const tabsCss = source(
    "src/design-system/primitives/tabs/tabs.module.css",
  );
  const studentManager = source("src/components/student-manager.tsx");
  const bulkDialog = source(
    "src/features/assignments/ui/bulk-assignment-editor.tsx",
  );

  it("keeps card tags content-sized and marks the active tab", () => {
    expect(css).not.toMatch(/\.student-card-info-row > \.meta-tag/);
    expect(badgeCss).toMatch(
      /\.badge\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*100%;/,
    );
    expect(tabsCss).toMatch(
      /\.dialog\s*\{[^}]*border-radius:\s*0;[^}]*background:\s*var\(--card\);/,
    );
    expect(tabsCss).toMatch(
      /\.tab:hover\s*\{[^}]*color:\s*var\(--ink\);[^}]*background:\s*var\(--surface\);/,
    );
    expect(tabsCss).toMatch(
      /\.tab\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--selection-active\);/,
    );
    const selectedTabRule =
      tabsCss.match(/\.tab\[aria-selected="true"\]\s*\{[^}]*\}/)?.[0] ??
      "";
    expect(selectedTabRule).not.toContain("outline:");
    expect(resetCss).toMatch(
      /\[tabindex\]:focus-visible,[^}]*\{[^}]*outline:\s*2px solid var\(--ink\);/,
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
    expect(tokens).toContain("--control-height-small: 36px;");
    expect(tokens).toContain("--control-height-default: 44px;");
    expect(tokens).toContain("--control-height-large: 58px;");
    expect(tokens).toContain("--control-height-icon: 36px;");
    expect(buttonCss).toMatch(
      /\.small\s*\{[^}]*height:\s*var\(--control-height-small\);/,
    );
    expect(buttonCss).toMatch(
      /\.icon\s*\{[^}]*width:\s*var\(--control-height-icon\);/,
    );
    expect(css).not.toContain(".bulk-assignment-form");
    expect(
      source(
        "src/features/assignments/ui/bulk-assignment-editor.module.css",
      ),
    ).toContain(".form");
    expect(assignmentEditorCss).toMatch(/\.layout\s*\{/);
    expect(bulkDialog).toContain("<AssignmentEditorLayout>");
    expect(bulkDialog).toContain(
      'from "@/design-system/primitives/button/button";',
    );
    expect(bulkDialog).toContain("<DialogHeader");
    expect(
      source("src/design-system/primitives/dialog/dialog.tsx"),
    ).toContain('size="small"');
  });

  it("uses structured groups and preserves learned wordbooks", () => {
    const copy = source("src/content/ko/admin-students.ts");
    expect(studentManager).toContain("groupCataloguedDatasets");
    expect(studentManager).toContain("<optgroup");
    expect(studentManager).toContain("adminStudentsText.learning.recentWordbookChange");
    expect(studentManager).toContain("StudentVocabBookHistoryList");
    expect(source("src/components/student-vocab-book-history-list.tsx")).toContain(
      "adminStudentsText.learning.wordbookHistory.title",
    );
    expect(copy).toContain('title: "학습한 단어장"');
  });

  it("현재 목록에서는 취소·삭제를 빼고 전체 내역에서만 보존한다", () => {
    const service = source("src/lib/services/admin-service.ts");
    const activityList = source(
      "src/components/student-learning-activity-list.tsx",
    );

    expect(service).toContain(
      'learningActivitySection(item) !== "archived"',
    );
    expect(activityList).toContain(
      'learningActivitySection(item) !== "archived"',
    );
    expect(activityList).toContain("...(filtersEnabled");
  });

  it("학생 카드도 공통 시험 종류와 실제 미응시 시각을 사용한다", () => {
    const studentPage = source("src/app/student/(protected)/page.tsx");
    const timeline = source(
      "src/lib/ui/learning-activity-presentation.ts",
    );

    expect(studentPage).toContain(
      "assignmentTypeLabel(assignment.assignmentPurpose)",
    );
    expect(timeline).toContain("item.missedAt ?? item.availableUntil");
  });
});
