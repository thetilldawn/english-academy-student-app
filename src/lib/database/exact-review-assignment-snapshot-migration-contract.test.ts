import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260830111500_lock_exact_review_assignment_snapshot.sql",
  ),
  "utf8",
);

describe("exact-review assignment snapshot migration contract", () => {
  it("applies the new writer and compatibility wrapper atomically", () => {
    expect(migration).toMatch(/\bbegin;[\s\S]*\bcommit;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.replace_student_assignment_v7(",
    );
    expect(migration).toContain(
      "create or replace function public.replace_student_assignment_v6(",
    );
    expect(migration).toContain(
      "select public.replace_student_assignment_v7(",
    );
  });

  it("locks exact-review direction and the complete question plan", () => {
    expect(migration).toContain(
      "create function private.persist_exact_review_question_plan_v1(",
    );
    expect(migration).toContain(
      "create or replace function private.create_exact_review_question_bank_exam_use_dispatch_v1(",
    );
    expect(migration).toContain(
      "set choice_vocab_entry_ids = planned.choice_vocab_entry_ids",
    );
    expect(migration).toContain(
      "p_english_to_korean_ratio is distinct from source_direction",
    );
    expect(migration).toContain(
      "requested_question_plan is distinct from source_question_plan",
    );
    expect(migration).toContain(
      "assignment_replacement_review_snapshot_contract_changed",
    );
    expect(migration).toContain(
      "assignment_replacement_review_snapshot_metadata_changed",
    );
    expect(migration).toContain(
      "setting.value in ('search_path=', 'search_path=\"\"')",
    );
  });

  it("keeps rolling deploy access narrow on both public versions", () => {
    for (const version of ["v6", "v7"]) {
      expect(migration).toContain(
        `revoke all on function public.replace_student_assignment_${version}(`,
      );
      expect(migration).toContain(
        `grant execute on function public.replace_student_assignment_${version}(`,
      );
    }
    expect(migration).toContain("to authenticated, service_role");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});
