import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260808222054_add_exam_use_exact_review_assignments.sql",
  ),
  "utf8",
);
const exactPersistenceMigration = readFileSync(
  resolve(
    "supabase/migrations/20260809082000_fix_exam_use_exact_direct_persistence.sql",
  ),
  "utf8",
);
const mixedRemapMigration = readFileSync(
  resolve(
    "supabase/migrations/20260809090000_fix_mixed_review_dictionary_remap.sql",
  ),
  "utf8",
);

describe("exam-use exact review dictionary identity migration", () => {
  it("snapshots immutable dictionary and occurrence identities across the wrong-word lifecycle", () => {
    expect(migration).toContain(
      "add column canonical_dictionary_id_snapshot text",
    );
    expect(migration).toContain(
      "add column exam_use_release_id_snapshot uuid",
    );
    expect(migration).toContain(
      "add column occurrence_id_snapshot text",
    );
    expect(migration).toContain(
      "create function private.snapshot_wrong_event_exam_use_identity_v1()",
    );
    expect(migration).toContain(
      "create function private.snapshot_review_queue_exam_use_identity_v1()",
    );
    expect(migration).toContain(
      "create function private.snapshot_review_target_dictionary_identity_v1()",
    );
  });

  it("uses dictionary then UUID then entry and only then a weak headword fallback", () => {
    const helperStart = migration.indexOf(
      "create function private.vocab_identity_matches_v1(",
    );
    const helperEnd = migration.indexOf(
      "create or replace function private.record_wrong_events_for_attempt(",
    );
    const helper = migration.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helper).toContain(
      "when p_left_dictionary_id is not null",
    );
    expect(helper).toContain(
      "when p_left_canonical_lexeme_id is not null",
    );
    expect(helper).toContain(
      "when p_left_vocab_entry_id = p_right_vocab_entry_id then true",
    );
    expect(helper).toContain(
      "and p_left_canonical_lexeme_id is null",
    );
  });

  it("routes every current creator through versioned dictionary-aware RPCs", () => {
    for (const signature of [
      "create function public.create_assignment_with_delivery_v6(",
      "create function public.create_mixed_review_assignment_v8(",
      "create function private.create_exact_review_assignment_v5(",
      "create function public.create_bulk_vocab_assignments_v3(p_batches jsonb)",
      "create function public.replace_student_assignment_v3(",
      "create function public.list_assignment_question_dictionary_identities_v1(",
    ]) {
      expect(migration).toContain(signature);
    }
    expect(migration).toContain(
      "private.create_assignment_with_question_bank_exam_use_dispatch_v1(",
    );
    expect(migration).toContain(
      "private.link_pending_review_targets_v2(",
    );
    expect(migration).toContain(
      "cardinality(p_selected_queue_ids) not between 4 and 400",
    );
  });

  it("keeps unresolved counts attempt-based and applies dictionary identity to resolve and reopen", () => {
    expect(migration).toContain(
      "count(distinct wrong_event.quiz_attempt_id)",
    );
    expect(migration).toContain(
      "create or replace function private.resolve_vocab_state_on_correct_answer()",
    );
    expect(migration).toContain(
      "create or replace function private.reopen_selected_vocab_review_queue_v1(",
    );
    expect(migration).toContain(
      "create or replace function\n  public.list_student_current_vocab_wrong_summaries(",
    );
    expect(migration).toContain(
      "wrong_event.wrong_stage = 'initial'",
    );
  });

  it("prevents old RPC versions from bypassing the new checks", () => {
    for (const signature of [
      "private.create_assignment_with_delivery_v5(",
      "public.create_assignment_with_delivery_v5(",
      "private.create_mixed_review_assignment_v7(",
      "public.create_mixed_review_assignment_v7(",
      "private.create_bulk_vocab_assignments_v2(jsonb)",
      "public.create_bulk_vocab_assignments_v2(jsonb)",
      "private.replace_student_assignment_v2(",
      "public.replace_student_assignment_v2(",
    ]) {
      const revoke = `revoke all on function ${signature}`;
      expect(migration).toContain(revoke);
    }
    expect(migration.trimEnd()).toMatch(
      /notify pgrst, 'reload schema';\s+commit;$/,
    );
  });

  it("persists exact review assignments directly through delivery v6", () => {
    expect(exactPersistenceMigration).toContain(
      "create or replace function private.create_exact_review_assignment_v5(",
    );
    expect(exactPersistenceMigration).toContain(
      "private.create_assignment_with_delivery_v6(",
    );
    expect(exactPersistenceMigration).toContain(
      "assignment_review_target_order_mismatch",
    );
    expect(exactPersistenceMigration).not.toContain("pg_get_functiondef");
    expect(exactPersistenceMigration.trimEnd()).toMatch(
      /notify pgrst, 'reload schema';\s+commit;$/,
    );
  });

  it("remaps historical review queues to the active release by dictionary identity", () => {
    const directMixedDefinition = mixedRemapMigration.slice(
      mixedRemapMigration.indexOf(
        "create or replace function private.create_mixed_review_assignment_v8(",
      ),
      mixedRemapMigration.indexOf(
        "-- Rebuild the draft-compatible persistence body",
      ),
    );
    expect(mixedRemapMigration).toContain(
      "create or replace function private.create_mixed_review_assignment_v8(",
    );
    expect(mixedRemapMigration).toContain(
      "private.vocab_identity_matches_v1(",
    );
    expect(mixedRemapMigration).toContain(
      "occurrence.release_id = active_release_id",
    );
    expect(mixedRemapMigration).toContain(
      "private.create_assignment_with_delivery_v6(",
    );
    expect(directMixedDefinition).not.toContain("pg_get_functiondef");
    expect(mixedRemapMigration.trimEnd()).toMatch(
      /notify pgrst, 'reload schema';\s+commit;$/,
    );
  });
});
