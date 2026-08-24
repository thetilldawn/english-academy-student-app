import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("bulk assignment preparation cache contract", () => {
  it("shares one request context across every preview capacity calculation", () => {
    const bulkAssignments = source(
      "src/lib/services/bulk-assignment-service.ts",
    );

    expect(bulkAssignments).toMatch(
      /resolveBulkAssignmentPreview[\s\S]*?calculateAssignmentCapacity\([\s\S]*?admin,\s*undefined,\s*mixedAssignmentPreparationCache\(context\),\s*\)/,
    );
  });

  it("reuses Preview request caches and legacy prepared plans during save", () => {
    const bulkAssignments = source(
      "src/lib/services/bulk-assignment-service.ts",
    );

    expect(bulkAssignments).toMatch(
      /const preparationContext = createBulkAssignmentPreparationContext\(\)[\s\S]*?resolveBulkAssignmentPreview\([\s\S]*?preparationContext/,
    );
    expect(bulkAssignments).toMatch(
      /const regularPreparationCache = preparationContext\.regular/,
    );
    expect(bulkAssignments).toMatch(
      /prepareRegularAssignment\([\s\S]*?admin,\s*undefined,\s*regularPreparationCache,\s*\)/,
    );
    expect(bulkAssignments).toContain(
      "preparedLegacySeriesByStudent.set(studentId, preparedSeries)",
    );
    expect(bulkAssignments).toMatch(
      /resolvedPreview\.preparedLegacySeriesByStudent\s*\.get\(item\.studentId\)/,
    );
  });

  it("keeps mixed and regular caches request-scoped Promise maps", () => {
    const mixedAssignments = source(
      "src/lib/services/mixed-assignment-service.ts",
    );
    const regularAssignments = source(
      "src/lib/services/regular-assignment-service.ts",
    );

    for (const serviceSource of [mixedAssignments, regularAssignments]) {
      expect(serviceSource).toContain(
        "supabase: createServerSupabaseClient()",
      );
      expect(serviceSource).toContain("activeAssignments: new Map()");
    }
    expect(mixedAssignments).toContain("students: new Map()");
    expect(mixedAssignments).toContain("datasets: new Map()");
    expect(mixedAssignments).toContain("reviewQueues: new Map()");
    expect(mixedAssignments).toContain("datasetLabels: new Map()");
    expect(regularAssignments).toContain("datasets: new Map()");
  });
});
