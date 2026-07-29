import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729115000_add_eligible_question_bank_v2.sql",
  ),
  "utf8",
);
const indexMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729121500_index_eligible_question_bank_foreign_keys.sql",
  ),
  "utf8",
);
const legacyRpcDeprecationMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729122500_deprecate_legacy_question_bank_rpcs.sql",
  ),
  "utf8",
);

const privateFunction = migration.slice(
  migration.indexOf(
    "create function private.create_assignment_with_question_bank_v2(",
  ),
  migration.indexOf(
    "create function public.create_assignment_with_question_bank_v2(",
  ),
);

describe("eligible question bank v2 migration", () => {
  it("keeps legacy rows explicit without rewriting saved quiz answers", () => {
    expect(migration).toContain("'legacy_backfill'");
    expect(migration).toContain("'verified_v2'");
    expect(migration).not.toMatch(
      /(?:update|delete\s+from)\s+public\.quiz_questions/i,
    );
    expect(migration).not.toMatch(
      /(?:update|delete\s+from)\s+public\.quiz_attempts/i,
    );
  });

  it("accepts only target and choice IDs, then builds trusted text in DB", () => {
    expect(privateFunction).toContain(
      "choice_vocab_entry_ids bigint[]",
    );
    expect(privateFunction).not.toContain("prompt text,");
    expect(privateFunction).not.toContain("choices jsonb,");
    expect(privateFunction).not.toContain(
      "correct_choice_index smallint",
    );
    expect(privateFunction).toContain(
      "then choice_entry.primary_meaning",
    );
    expect(privateFunction).toContain("else choice_entry.headword");
    expect(privateFunction).toContain(
      "array_position(\n          question.choice_vocab_entry_ids",
    );
    expect(privateFunction).toContain(
      "p_student_ids,\n      trusted_questions",
    );
  });

  it("revalidates target and every choice against current eligibility", () => {
    expect(privateFunction).toContain(
      "question_not_eligible_for_direction",
    );
    expect(privateFunction).toContain(
      "choice_not_eligible_for_direction",
    );
    expect(privateFunction).toContain(
      "eligibility.input_content_hash",
    );
    expect(privateFunction).toContain(
      "choice_eligibility.input_content_hash",
    );
    expect(privateFunction).toContain(
      "capability.dataset_source_sha256",
    );
    expect(privateFunction).toContain(
      "choice_capability.canonical_snapshot_sha256",
    );
  });

  it("snapshots each direction capability and hashes every question bank", () => {
    expect(migration).toContain(
      "create table public.assignment_quiz_mode_snapshots (",
    );
    expect(migration).toContain("capability_snapshot_sha256");
    expect(privateFunction).toContain("question_content_sha256");
    expect(privateFunction).toContain("calculated_bank_sha256");
    expect(privateFunction).toContain(
      "question_bank_version = 2",
    );
  });

  it("keeps the private implementation guarded but callable by wrapper", () => {
    expect(privateFunction).toContain(
      "if not (select private.is_active_admin())",
    );
    expect(migration).toContain(
      "grant execute on function\n  private.create_assignment_with_question_bank_v2(",
    );
    expect(migration).toContain(
      ") to authenticated, service_role;",
    );
    expect(migration).toContain(
      "security invoker\nset search_path = ''",
    );
  });

  it("enables RLS and blocks anonymous table access", () => {
    expect(migration).toContain(
      "alter table public.assignment_quiz_mode_snapshots\n  enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.assignment_quiz_mode_snapshots\n  from public, anon, authenticated;",
    );
  });

  it("covers every new non-leading foreign key", () => {
    for (const index of [
      "assignment_questions_canonical_lexeme_snapshot_idx",
      "assignment_questions_content_review_snapshot_idx",
      "assignment_quiz_mode_snapshots_assignment_dataset_idx",
    ]) {
      expect(indexMigration).toContain(`create index ${index}`);
    }
  });

  it("blocks clients from bypassing the verified v2 wrapper", () => {
    expect(legacyRpcDeprecationMigration).toContain(
      "revoke execute on function private.create_assignment_with_question_bank(",
    );
    expect(legacyRpcDeprecationMigration).toContain(
      "revoke execute on function public.create_assignment_with_question_bank(",
    );
    expect(legacyRpcDeprecationMigration).toContain(
      ") from authenticated;",
    );
    expect(legacyRpcDeprecationMigration).not.toContain(
      "create_assignment_with_question_bank_v2",
    );
  });
});
