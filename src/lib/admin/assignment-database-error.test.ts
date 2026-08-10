import { describe, expect, it } from "vitest";

import { isAssignmentPersistenceInvariantFailure } from "@/lib/admin/assignment-database-error";

describe("assignment database error classification", () => {
  it("treats writer cardinality invariants as server failures", () => {
    expect(
      isAssignmentPersistenceInvariantFailure({
        code: "21000",
        message: "v2_question_provenance_count_mismatch",
      }),
    ).toBe(true);
  });

  it("keeps teacher input errors outside the persistence invariant class", () => {
    expect(
      isAssignmentPersistenceInvariantFailure({
        code: "22023",
        message: "question_plan_invalid",
      }),
    ).toBe(false);
  });
});
