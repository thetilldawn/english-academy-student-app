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
    expect(routeDialog).toContain("event.preventDefault()");
  });
});
