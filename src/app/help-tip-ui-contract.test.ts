import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("공통 도움말 UI 계약", () => {
  it("모달 클리핑을 피하는 top-layer popover와 접근성 연결을 사용한다", () => {
    const component = source("src/components/help-tip.tsx");
    const css = source("src/app/globals.css");

    expect(component).toContain('popover="auto"');
    expect(component).toContain("aria-describedby={tooltipId}");
    expect(component).toContain('role="tooltip"');
    expect(component).toContain("tooltip.showPopover()");
    expect(component).toContain("getBoundingClientRect()");
    expect(css).toContain(".help-tip-content[popover]");
    expect(css).toContain("border: 1px solid currentColor");
    expect(css).toContain("border-radius: 50%");
    expect(css).not.toContain("var(--line-strong)");
  });

  it("도움말 버튼과 입력 라벨을 별도 labelable 요소로 연결한다", () => {
    const sources = [
      "src/components/assignment-manager.tsx",
      "src/components/bulk-assignment-dialog.tsx",
      "src/components/review-assignment-dialog.tsx",
      "src/components/student-manager.tsx",
    ].map(source);

    for (const component of sources) {
      expect(component).not.toMatch(
        /<label className="field">[\s\S]{0,500}<HelpTip/,
      );
    }
    expect(sources.join("\n")).toContain(
      'htmlFor="assignment-available-until"',
    );
    expect(sources.join("\n")).toContain(
      'id="assignment-available-until"',
    );
  });
});
