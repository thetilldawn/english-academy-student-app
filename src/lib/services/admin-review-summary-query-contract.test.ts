import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin pending-review summary query", () => {
  it("학생별 상세 이력 N+1 대신 집계 RPC를 커서로 이어 읽는다", () => {
    const adminService = source(
      "src/lib/services/admin-student-read-service.ts",
    );
    const functionBody = adminService.slice(
      adminService.indexOf(
        "export async function listStudentPendingReviewSummaries",
      ),
    );

    expect(functionBody).toContain(
      '"list_student_vocab_review_queue_summaries"',
    );
    expect(functionBody).toContain("const pageSize = 500");
    expect(functionBody).toContain(
      "p_after_student_id: afterStudentId",
    );
    expect(functionBody).toContain(
      "p_after_dataset_id: afterDatasetId",
    );
    expect(functionBody).toContain("p_limit: pageSize");
    expect(functionBody).toContain("if (page.length < pageSize) break");
    expect(functionBody).toContain(
      "afterStudentId = last.studentId",
    );
    expect(functionBody).toContain(
      "afterDatasetId = last.datasetId",
    );
    expect(functionBody).not.toContain(
      "getStudentWrongWordHistory(",
    );
    expect(functionBody).toContain(
      "parseStudentPendingReviewSummaries(",
    );
  });
});
