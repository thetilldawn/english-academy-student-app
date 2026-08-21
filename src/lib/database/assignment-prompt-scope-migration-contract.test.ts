import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(
    "supabase/migrations/20260822140000_scope_korean_prompt_ambiguity_to_selected_questions.sql",
  ),
  "utf8",
);

describe("assignment Korean prompt scope migration", () => {
  it("patches both the administrator and queued-session writers", () => {
    expect(migration).toContain(
      "private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)",
    );
    expect(migration).toContain(
      "private.create_assignment_with_question_bank_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)",
    );
  });

  it("compares only other Korean-to-English questions in the same assignment", () => {
    expect(migration).toContain(
      "from public.assignment_questions as other_question",
    );
    expect(migration).toContain(
      "other_question.assignment_id = created_assignment_id",
    );
    expect(migration).toContain("other_question.id <> question.id");
    expect(migration).toContain(
      "other_question.direction = ''korean_to_english''",
    );
    expect(migration).toContain(
      "other_entry.headword_normalized\\n                  <> entry.headword_normalized",
    );
    expect(migration).toContain(
      "lower(trim(other_entry.primary_meaning))\\n                  = lower(trim(entry.primary_meaning))",
    );
  });

  it("fails closed if the live function shape or metadata changes", () => {
    expect(migration).toContain("old_guard_count <> 1");
    expect(migration).toContain("selected_guard_count <> 0");
    expect(migration).toContain("assignment_prompt_scope_shape_changed");
    expect(migration).toContain("assignment_prompt_scope_rewrite_failed");
    expect(migration).toContain("assignment_prompt_scope_metadata_changed");
    expect(migration).toContain("procedure.proowner <> owner_before");
    expect(migration).toContain(
      "procedure.proacl is distinct from acl_before",
    );
    expect(migration).toContain(
      "procedure.proconfig is distinct from config_before",
    );
  });
});
