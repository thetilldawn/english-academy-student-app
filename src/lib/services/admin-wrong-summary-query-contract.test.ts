import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin student wrong-summary query", () => {
  it("uses the student-detail snapshot instead of a separate all-student query", () => {
    const query = source(
      "src/features/students/server/queries/student-detail-query.ts",
    );
    const schema = source(
      "src/features/students/server/queries/student-detail-row-schema.ts",
    );

    expect(query).toContain('"get_admin_student_detail_initial_v2"');
    expect(query).toContain("wrongSummary: parsed.data.wrongSummary");
    expect(schema).toContain("wrongSummary: z.object({");
    expect(schema).toContain("wrongWordCount: z.coerce.number().int().nonnegative()");
    expect(schema).toContain(
      "repeatedWrongWordCount: z.coerce.number().int().nonnegative()",
    );
  });
});
