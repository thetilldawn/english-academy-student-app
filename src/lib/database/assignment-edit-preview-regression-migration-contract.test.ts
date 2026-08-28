import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829103000_fix_assignment_edit_preview_regressions.sql",
  ),
  "utf8",
);

describe("assignment edit preview regression migration contract", () => {
  it("keeps the exact-review small-count path separate from regular persistence", () => {
    expect(migration).toMatch(/\bbegin;[\s\S]*\bcommit;/);
    expect(migration).toContain(
      "private.persist_review_assignment_exam_use_v6_compat(",
    );
    expect(migration).toContain(
      "private.persist_exact_review_assignment_exam_use_v7_compat(",
    );
    expect(migration).toContain(
      "private.create_assignment_with_question_bank_exam_use_dispatch_v1(",
    );
    expect(migration).toContain(
      "private.create_exact_review_question_bank_exam_use_dispatch_v1(",
    );
    expect(migration).toContain(
      "return private.persist_exact_review_assignment_exam_use_v7_compat(",
    );
    expect(migration).not.toContain(
      "p_question_count not between 1 and 500",
    );
  });

  it("keeps exact replacement helpers private and preserves security metadata", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "exact_review_replacement_persist_contract_changed",
    );
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
  });

  it("captures the series rebound time only after replacement succeeds", () => {
    const declaration = migration.indexOf("rebound_at timestamptz;");
    const reboundCapture = migration.indexOf(
      "rebound_at := clock_timestamp();",
    );
    const replacementRequestUpdate = migration.indexOf(
      "update private.assignment_replacement_requests",
      reboundCapture,
    );

    expect(declaration).toBeGreaterThan(-1);
    expect(reboundCapture).toBeGreaterThan(-1);
    expect(replacementRequestUpdate).toBeGreaterThan(reboundCapture);
    expect(migration).toContain(
      "assignment_replacement_rebound_metadata_changed",
    );
  });
});
