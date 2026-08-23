import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260824020000_add_small_exact_review_exam_use_path.sql",
  ),
  "utf8",
);

describe("small exam-use direct review migration", () => {
  it("keeps the regular floor and creates a private 1-question exact-review path", () => {
    expect(migration).toContain(
      "private.create_exact_review_with_exam_use_question_bank_v1(",
    );
    expect(migration).toContain(
      "private.create_exact_review_question_bank_exam_use_dispatch_v1(",
    );
    expect(migration).toContain(
      "private.create_exact_review_assignment_with_delivery_v1(",
    );
    expect(migration).toContain(
      "p_question_count not between 4 and 500",
    );
    expect(migration).toContain(
      "p_question_count not between 1 and 500",
    );
    expect(migration).toContain(
      "cardinality(p_selected_queue_ids) not between 1 and 400",
    );
    expect(migration).toContain(
      "assignment.exact_review_delivery_v1_created",
    );
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).not.toContain(
      "create or replace function public.create_assignment_with_delivery_v6",
    );
  });
});
