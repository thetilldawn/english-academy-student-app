import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin direct-review summary query", () => {
  it("loads review summaries only for the student whose assignment editor is open", () => {
    const service = source(
      "src/lib/services/direct-review-candidate-service.ts",
    );
    const body = service.slice(
      service.indexOf(
        "export async function listStudentDirectReviewDatasetSummaries",
      ),
      service.indexOf(
        "export async function listStudentDirectReviewCandidates",
      ),
    );

    expect(body).toContain(
      '"list_student_direct_review_dataset_summaries_v1"',
    );
    expect(body).toContain("p_student_id: studentId");
    expect(body).toContain("parseDirectReviewDatasetSummaries(");
    expect(body).not.toContain("pageSize");
  });
});
