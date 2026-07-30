import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin current-vocabulary wrong summary query", () => {
  it("reads one paged aggregate RPC instead of loading every history", () => {
    const adminService = source("src/lib/services/admin-service.ts");
    const start = adminService.indexOf(
      "export async function listStudentCurrentVocabWrongSummaries",
    );
    const body = adminService.slice(
      start,
      adminService.indexOf("type HistoryStudentRelation", start),
    );

    expect(body).toContain(
      '"list_student_current_vocab_wrong_summaries"',
    );
    expect(body).toContain("const pageSize = 500");
    expect(body).toContain(
      "p_after_student_id: afterStudentId",
    );
    expect(body).toContain("p_limit: pageSize");
    expect(body).toContain("if (page.length < pageSize) break");
    expect(body).toContain("afterStudentId = last.studentId");
    expect(body).toContain(
      "parseStudentCurrentVocabWrongSummaries(",
    );
    expect(body).not.toContain("getStudentWrongWordHistory(");
  });
});
