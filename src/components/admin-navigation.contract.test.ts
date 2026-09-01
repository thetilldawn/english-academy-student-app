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

  it("shows route-specific loading and safe recovery copy for results and assignments", () => {
    const historyContent = source("src/content/ko/admin-history.ts");
    const learningContent = source("src/content/ko/admin-learning.ts");
    const resultsPage = source("src/app/admin/(protected)/results/page.tsx");
    const resultsLoading = source(
      "src/app/admin/(protected)/results/loading.tsx",
    );
    const resultsError = source("src/app/admin/(protected)/results/error.tsx");
    const assignmentsPage = source(
      "src/app/admin/(protected)/assignments/page.tsx",
    );
    const assignmentsLoading = source(
      "src/app/admin/(protected)/assignments/loading.tsx",
    );
    const assignmentsError = source(
      "src/app/admin/(protected)/assignments/error.tsx",
    );

    expect(historyContent).toContain('loading: "내역을 불러오는 중…"');
    expect(historyContent).toContain('errorTitle: "내역을 불러오지 못했습니다"');
    expect(resultsPage).toContain("adminHistoryText.page.loading");
    expect(resultsLoading).toContain("adminHistoryText.page.loading");
    expect(resultsError).toContain("adminHistoryText.page.errorDescription");
    expect(resultsError).toContain("client.admin_history_error_boundary");

    expect(learningContent).toContain(
      'loading: "단어 배정 화면을 불러오는 중…"',
    );
    expect(learningContent).toContain(
      'errorTitle: "단어 배정 화면을 불러오지 못했습니다"',
    );
    expect(assignmentsPage).toContain("adminLearningText.page.loading");
    expect(assignmentsLoading).toContain("adminLearningText.page.loading");
    expect(assignmentsError).toContain(
      "adminLearningText.page.errorDescription",
    );
    expect(assignmentsError).toContain(
      "client.assignment_workspace_error_boundary",
    );
    expect(resultsPage).not.toContain("adminShellText.loading");
    expect(assignmentsPage).not.toContain("adminShellText.loading");
  });
});
