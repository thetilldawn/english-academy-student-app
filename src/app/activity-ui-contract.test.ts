import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(left: string, right: string) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("shared activity UI contract", () => {
  it("removes migrated primitive selectors and keeps feature row authorities", () => {
    const css = source("src/app/globals.css");
    const activityRowCss = source(
      "src/design-system/patterns/activity-row/activity-row.module.css",
    );

    expect(css.match(/^\.status-pill\s*\{/gm) ?? []).toHaveLength(0);
    expect(css.match(/^\.assignment-student-row\s*\{/gm) ?? []).toHaveLength(0);
    expect(css.match(/^\.admin-history-row\s*\{/gm) ?? []).toHaveLength(0);
    expect(css).not.toContain(
      ".assignment-student-row span:not(.button)",
    );
    expect(activityRowCss).toContain(
      '.content[data-has-score="false"][data-has-timeline="true"]',
    );
    expect(activityRowCss).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(210px, auto)",
    );
  });

  it("separates a selectable row's checkbox, keyboard target, and actions", () => {
    const rows = source(
      "src/design-system/patterns/activity-row/activity-row.tsx",
    );
    const assignmentManager = source(
      "src/components/assignment-manager.tsx",
    );

    expect(rows).toContain("<Checkbox");
    expect(rows).toContain("aria-label={selectionAriaLabel}");
    expect(rows).toContain("onChange={onToggle}");
    expect(rows).toContain("onClick={onToggle}");
    expect(rows).not.toContain('aria-pressed={checked}');
    expect(rows).toContain("styles.actions");
    expect(assignmentManager).toContain("onToggle={() => toggleBulkStudent");
    expect(assignmentManager).toContain(
      "adminLearningText.page.studentCard.view",
    );
    expect(assignmentManager).toContain(
      "adminLearningText.page.studentCard.newAssignment",
    );
  });

  it("keeps every filled activity status readable with white text", () => {
    for (const background of ["#176b3a", "#7a5700", "#a3322b", "#575650"]) {
      expect(contrast(background, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps count badges white without muting every heading child", () => {
    const css = source("src/app/globals.css");
    const badgeCss = source(
      "src/design-system/primitives/badge/badge.module.css",
    );
    const tokens = source("src/styles/tokens.css");
    const assignmentManager = source(
      "src/components/assignment-manager.tsx",
    );
    const bulkDialog = source(
      "src/features/assignments/ui/bulk-series-preview.tsx",
    );
    const wordbookHistory = source(
      "src/components/student-vocab-book-history-list.tsx",
    );

    expect(css).not.toContain(".learning-section-heading span");
    expect(css).toMatch(
      /\.learning-section-summary\s*\{[^}]*color:\s*var\(--muted\);/,
    );
    expect(css).not.toMatch(/\.count-badge\s*\{/);
    expect(badgeCss).toMatch(
      /\.status\s*\{[^}]*color:\s*var\(--status-fg\);/,
    );
    expect(tokens).toContain("--status-fg: #ffffff;");
    expect(assignmentManager).toContain(
      'className="learning-section-summary"',
    );
    expect(bulkDialog).toContain(
      "className={styles.previewSummary}",
    );
    expect(wordbookHistory).toContain(
      'className="learning-section-summary"',
    );
  });

  it("uses a sibling route dialog and preserves the background segment", () => {
    const layout = source("src/app/admin/(protected)/layout.tsx");
    const navigation = source("src/components/admin-navigation.tsx");
    const routeDialog = source(
      "src/features/history/ui/route-detail-dialog.tsx",
    );

    expect(layout).toContain("{detail}");
    expect(navigation).toContain("useSelectedLayoutSegment");
    expect(routeDialog).toContain("router.back()");
    expect(routeDialog).toContain("<DialogFrame");
    expect(routeDialog).toContain("onRequestClose={close}");
  });
});
