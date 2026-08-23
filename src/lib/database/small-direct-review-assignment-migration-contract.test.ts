import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260824013000_allow_small_direct_review_assignments.sql",
  ),
  "utf8",
);

describe("small direct review assignment migration", () => {
  it("오답 전용 v5 함수의 선택 수만 1~400으로 안전하게 바꾼다", () => {
    expect(migration).toContain(
      "private.create_exact_review_assignment_v5(",
    );
    expect(migration).toContain(
      "cardinality(p_selected_queue_ids) not between 4 and 400",
    );
    expect(migration).toContain(
      "cardinality(p_selected_queue_ids) not between 1 and 400",
    );
    expect(migration).toContain("occurrence_count <> 1");
    expect(migration).not.toContain("create_mixed_review_assignment");
    expect(migration).not.toContain("create_assignment_with_delivery");
  });
});
