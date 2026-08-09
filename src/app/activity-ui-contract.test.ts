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
  it("keeps one base rule for each migrated legacy selector", () => {
    const css = source("src/app/globals.css");

    expect(css.match(/^\.status-pill\s*\{/gm)).toHaveLength(1);
    expect(css.match(/^\.assignment-student-row\s*\{/gm)).toHaveLength(1);
    expect(css.match(/^\.admin-history-row\s*\{/gm)).toHaveLength(1);
    expect(css).not.toContain(
      ".assignment-student-row span:not(.button)",
    );
  });

  it("separates a selectable row's checkbox, keyboard target, and actions", () => {
    const rows = source("src/components/ui-list-row.tsx");
    const assignmentManager = source(
      "src/components/assignment-manager.tsx",
    );

    expect(rows).toContain('type="checkbox"');
    expect(rows).toContain('aria-pressed={checked}');
    expect(rows).toContain('type="button"');
    expect(rows).toContain("selectable-list-row-actions");
    expect(assignmentManager).toContain("onToggle={() => toggleBulkStudent");
    expect(assignmentManager).toContain(
      "adminLearningText.page.studentCard.view",
    );
  });

  it("keeps every filled activity status readable with white text", () => {
    for (const background of ["#176b3a", "#7a5700", "#a3322b", "#575650"]) {
      expect(contrast(background, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses a sibling route dialog and preserves the background segment", () => {
    const layout = source("src/app/admin/(protected)/layout.tsx");
    const navigation = source("src/components/admin-navigation.tsx");
    const routeDialog = source("src/components/route-detail-dialog.tsx");

    expect(layout).toContain("{detail}");
    expect(navigation).toContain("useSelectedLayoutSegment");
    expect(routeDialog).toContain("router.back()");
    expect(routeDialog).toContain("closeOnBackdrop");
  });
});
