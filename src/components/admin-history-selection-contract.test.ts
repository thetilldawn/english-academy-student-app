import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin history route detail contract", () => {
  it("opens detail by address and closes only the intercepted layer", () => {
    const historyList = source("src/components/admin-history-list.tsx");
    const routeDialog = source("src/components/route-detail-dialog.tsx");

    expect(historyList).toContain("historyDetailHref(item)");
    expect(historyList).not.toContain("useRef<HTMLDialogElement>");
    expect(historyList).not.toContain("selectedId");
    expect(routeDialog).toContain("router.back()");
    expect(routeDialog).toContain("<DialogFrame");
    expect(routeDialog).toContain("onRequestClose={close}");
  });

  it("학습 관리에서는 체크박스만 선택하고 카드 본문은 상세를 연다", () => {
    const rows = source("src/components/ui-list-row.tsx");
    const manager = source("src/components/assignment-manager.tsx");

    expect(rows).toContain("aria-label={selectionAriaLabel}");
    expect(rows).toContain("onChange={onToggle}");
    expect(rows).toContain("href={href}");
    expect(rows).not.toContain("onClick={onToggle}");
    expect(rows).not.toContain('aria-hidden="true"');
    expect(manager).toContain("href={");
    expect(manager).toContain("historyDetailHref(nextActivity)");
  });
});
