import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const version =
  "20260810083130_align_v2_question_provenance_runtime_eligibility.sql";
const migration = fs.readFileSync(
  path.resolve("supabase/migrations", version),
  "utf8",
);
const rollback = fs.readFileSync(
  path.resolve("supabase/rollback", version),
  "utf8",
);

describe("question provenance runtime eligibility migration", () => {
  it("replaces the one legacy provenance predicate with the shared runtime rule", () => {
    expect(migration).toContain("question_bank_v2_provenance_contract_changed");
    expect(migration).toContain("question_bank_v2_provenance_rewrite_failed");
    expect(migration).toContain(
      "private.quiz_eligibility_runtime_allowed_v1(eligibility.status, eligibility.reason_codes)",
    );
    expect(migration).toContain("v2_question_provenance_count_mismatch");
  });

  it("preserves private function metadata and execution boundaries", () => {
    for (const source of [migration, rollback]) {
      expect(source).toContain("proowner = owner_before");
      expect(source).toContain("proacl is not distinct from acl_before");
      expect(source).toContain("prorettype = return_type_before");
      expect(source).toContain("prosecdef = security_definer_before");
      expect(source).toContain("'search_path=\"\"'");
      expect(source).toContain(
        ") from public, anon, authenticated, service_role;",
      );
    }
  });

  it("keeps rollback limited to the guarded provenance predicate", () => {
    expect(rollback).toContain(
      "question_bank_v2_provenance_rollback_shape_changed",
    );
    expect(rollback).toContain("and eligibility.status = ''eligible''");
  });
});
