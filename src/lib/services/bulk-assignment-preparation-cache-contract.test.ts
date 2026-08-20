import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("bulk assignment preparation cache contract", () => {
  it("shares one mixed cache across every preview capacity calculation", () => {
    const bulkAssignments = source(
      "src/lib/services/bulk-assignment-service.ts",
    );

    expect(bulkAssignments).toMatch(
      /previewBulkAssignments[\s\S]*?const preparationCache = createMixedAssignmentPreparationCache\(\)[\s\S]*?calculateAssignmentCapacity\([\s\S]*?admin,\s*undefined,\s*preparationCache,\s*\)/,
    );
  });

  it("shares request caches across mixed and regular save preparation", () => {
    const bulkAssignments = source(
      "src/lib/services/bulk-assignment-service.ts",
    );

    expect(bulkAssignments).toMatch(
      /const mixedPreparationCache =\s*createMixedAssignmentPreparationCache\(\)/,
    );
    expect(bulkAssignments).toMatch(
      /const regularPreparationCache =\s*createRegularAssignmentPreparationCache\(\)/,
    );
    expect(bulkAssignments).toMatch(
      /prepareMixedAssignmentBatch\([\s\S]*?admin,\s*undefined,\s*mixedPreparationCache,\s*\)/,
    );
    expect(bulkAssignments).toMatch(
      /prepareRegularAssignment\([\s\S]*?admin,\s*undefined,\s*regularPreparationCache,\s*\)/,
    );
  });

  it("keeps mixed and regular caches request-scoped Promise maps", () => {
    const mixedAssignments = source(
      "src/lib/services/mixed-assignment-service.ts",
    );
    const adminService = source("src/lib/services/admin-service.ts");

    for (const serviceSource of [mixedAssignments, adminService]) {
      expect(serviceSource).toContain(
        "supabase: createServerSupabaseClient()",
      );
      expect(serviceSource).toContain("activeAssignments: new Map()");
    }
    expect(mixedAssignments).toContain("students: new Map()");
    expect(mixedAssignments).toContain("datasets: new Map()");
    expect(mixedAssignments).toContain("reviewQueues: new Map()");
    expect(mixedAssignments).toContain("datasetLabels: new Map()");
    expect(adminService).toContain("datasets: new Map()");
  });
});
