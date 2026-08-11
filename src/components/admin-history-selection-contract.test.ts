import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin history route detail contract", () => {
  it("opens detail by address and closes only the intercepted layer", () => {
    const historyList = source(
      "src/features/history/ui/admin-history-list.tsx",
    );
    const routeDialog = source(
      "src/features/history/ui/route-detail-dialog.tsx",
    );
    const historyRow = source(
      "src/features/history/ui/history-activity-row.tsx",
    );

    expect(historyList).toContain("<HistoryRows items={filteredItems}");
    expect(historyRow).toContain("historyDetailHref(item)");
    expect(historyList).not.toContain("useRef<HTMLDialogElement>");
    expect(historyList).not.toContain("selectedId");
    expect(routeDialog).toContain("router.back()");
    expect(routeDialog).toContain("<DialogFrame");
    expect(routeDialog).toContain("onRequestClose={close}");
  });

  it("학습 관리에서는 체크박스와 본문을 선택에 쓰고 보기만 상세를 연다", () => {
    const rows = source(
      "src/design-system/patterns/activity-row/activity-row.tsx",
    );
    const manager = source("src/components/assignment-manager.tsx");

    expect(rows).toContain("aria-label={selectionAriaLabel}");
    expect(rows).toContain("onChange={onToggle}");
    expect(rows).toContain("onClick={onToggle}");
    expect(rows).not.toContain('aria-hidden="true"');
    expect(manager).toContain("<ButtonLink");
    expect(manager).toContain("historyDetailHref(nextActivity)");
  });
});
