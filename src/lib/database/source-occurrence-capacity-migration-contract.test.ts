import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260810044950_align_source_occurrence_assignment_capacity.sql",
  ),
  "utf8",
);
const rollback = fs.readFileSync(
  path.resolve(
    "supabase/rollback/20260810044950_align_source_occurrence_assignment_capacity.sql",
  ),
  "utf8",
);

describe("source occurrence assignment capacity migration", () => {
  it("rewrites exactly the legacy normalized-headword capacity guard", () => {
    expect(migration).toContain("pg_get_functiondef(function_oid)");
    expect(migration).toContain("count(DISTINCT entry.id)");
    expect(migration).toContain(
      "assignment_occurrence_capacity_rewrite_failed",
    );
    expect(migration).toContain(
      "p_question_count not between 1 and 500",
    );
    expect(migration).toContain("private.is_active_admin()");
  });

  it("preserves function metadata and keeps legacy core private", () => {
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

  it("rollback only reverses the guarded capacity expression", () => {
    expect(rollback).toContain(
      "count(DISTINCT entry.headword_normalized)",
    );
    expect(rollback).toContain(
      "assignment_occurrence_capacity_rollback_rewrite_failed",
    );
  });
});
