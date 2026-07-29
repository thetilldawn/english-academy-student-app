import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("src/components/admin-history-list.tsx"),
  "utf8",
);

describe("admin history selection contract", () => {
  it("re-derives the selected item after a refreshed item list", () => {
    expect(source).toContain(
      "const [selectedId, setSelectedId] = useState<string | null>",
    );
    expect(source).toContain(
      "items.find((item) => item.id === selectedId) ?? null",
    );
    expect(source).not.toContain(
      "useState<AssignmentHistorySummary | null>",
    );
  });
});
