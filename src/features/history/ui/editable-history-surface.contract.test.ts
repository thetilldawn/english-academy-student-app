import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("editable history surface contract", () => {
  it("uses the same top-level edit state for intercepted and direct routes", () => {
    const interceptedPage = source(
      "src/app/admin/(protected)/@detail/(.)results/[entryKey]/page.tsx",
    );
    const directPage = source(
      "src/app/admin/(protected)/results/[id]/page.tsx",
    );
    const actions = source(
      "src/features/history/ui/history-detail-actions.tsx",
    );
    const overlay = source(
      "src/features/history/ui/editable-history-detail-dialog.tsx",
    );
    const page = source(
      "src/features/history/ui/editable-history-detail-page.tsx",
    );

    expect(interceptedPage).toContain("<EditableHistoryDetailDialog");
    expect(directPage).toContain("<EditableHistoryDetailPage");
    expect(actions).not.toMatch(/SingleAssignmentEditor|editorHeading/);
    expect(overlay).toContain('submitPlacement="external"');
    expect(page).toContain('submitPlacement="external"');
    expect(`${overlay}\n${page}`).toContain("useEditableHistoryAssignment");
  });
});
