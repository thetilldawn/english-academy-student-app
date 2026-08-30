import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

const consumers = [
  "src/features/student-dashboard/domain/student-assignment-sections.ts",
  "src/features/student-dashboard/ui/student-assignment-card.tsx",
  "src/features/students/contracts/student-detail-read-model.ts",
  "src/features/students/server/queries/student-detail-query.ts",
  "src/features/students/server/queries/student-detail-row-schema.ts",
  "src/features/students/server/queries/student-history-query.ts",
  "src/features/students/server/queries/student-history-row-schema.ts",
  "src/features/students/ui/panels/student-learning-history.tsx",
];

describe("history public feature boundary", () => {
  it("keeps other features out of history internals", () => {
    for (const file of consumers) {
      const content = source(file);
      expect(content, file).not.toMatch(
        /@\/features\/history\/(?:contracts|domain|presentation|server|ui)\//u,
      );
    }
  });

  it("publishes serializable contracts, server parsers, and shared UI separately", () => {
    const contracts = source("src/features/history/public-contracts.ts");
    const server = source("src/features/history/public-server.ts");
    const ui = source("src/features/history/public-ui.ts");

    expect(contracts).toContain("deriveLearningActivityState");
    expect(contracts).toContain("buildAttemptStatusPresentation");
    expect(server).toContain("adminHistoryListItemSchema");
    expect(server).toContain("mapAdminHistoryDetailItem");
    expect(ui).toContain("StudentLearningActivityList");
    expect(ui).toContain("ActivityStatusTimeline");
  });
});
