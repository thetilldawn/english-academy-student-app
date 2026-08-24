import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260824043000_allow_sparse_question_bank_writer.sql",
  ),
  "utf8",
);

describe("sparse question-bank writer migration contract", () => {
  it("replaces only the legacy contiguous guard with the direction resolver", () => {
    expect(migration).toContain("units_must_be_contiguous");
    expect(migration).toContain(
      "perform private.resolve_contiguous_unit_direction_v1(",
    );
    expect(migration).toContain("sparse_question_bank_writer_shape_changed");
    expect(migration).toContain("sparse_question_bank_writer_rewrite_failed");
    expect(migration).toContain(
      "private.create_assignment_with_question_bank_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)",
    );
    expect(migration).toContain(
      "sparse_question_bank_system_writer_rewrite_failed",
    );
  });

  it("preserves writer security metadata and keeps direct execution private", () => {
    expect(migration).toContain("proowner = owner_before");
    expect(migration).toContain("proacl is not distinct from acl_before");
    expect(migration).toContain("prosecdef = security_definer_before");
    expect(migration).toContain("proconfig is not distinct from config_before");
    expect(migration).toContain(
      "from public, anon, authenticated, service_role;",
    );
  });

  it("retains the reviewed question-count and admin guards", () => {
    expect(migration).toContain("private.is_active_admin()");
    expect(migration).toContain("p_question_count not between 1 and 500");
    expect(migration).toContain("p_actor_admin_id");
  });
});
