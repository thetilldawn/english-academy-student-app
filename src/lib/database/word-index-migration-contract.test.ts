import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729104159_add_private_word_index_foundation.sql",
  ),
  "utf8",
);
const indexMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729105114_add_word_index_foreign_key_indexes.sql",
  ),
  "utf8",
);
const importMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729105936_add_word_index_import_batches.sql",
  ),
  "utf8",
);
const rawPointerIdentifierMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729110820_preserve_non_uuid_raw_pointer_ids.sql",
  ),
  "utf8",
);
const bridgeMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729111329_bridge_vocab_datasets_to_word_index.sql",
  ),
  "utf8",
);
const bridgeIndexMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260729113400_index_vocab_link_foreign_keys.sql",
  ),
  "utf8",
);

describe("private canonical word index migration", () => {
  it("keeps the canonical index outside the public API schema", () => {
    expect(migration).toContain("create schema if not exists word_index;");
    expect(migration).toContain(
      "revoke all on schema word_index from public, anon, authenticated;",
    );
    expect(migration).not.toContain(
      "grant usage on schema word_index to authenticated",
    );
  });

  it("preserves snapshot, canonical content, source, and review evidence", () => {
    const requiredTables = [
      "schema_meta",
      "index_build",
      "input_file_manifest",
      "lexeme",
      "sense",
      "etymology",
      "source",
      "occurrence",
      "relation",
      "relation_evidence",
      "example",
      "review",
      "raw_pointer",
      "level_mapping",
      "type_decision",
      "data_issue",
      "pipeline_rule",
      "legacy_freeze",
      "work_queue",
      "lexeme_tag",
      "lexeme_metric",
    ];

    for (const table of requiredTables) {
      expect(migration).toContain(`create table word_index.${table} (`);
    }
  });

  it("calculates readiness instead of storing a manual ready flag", () => {
    expect(migration).toContain("create view word_index.v_readiness");
    expect(migration).toContain("review.stage = 'format'");
    expect(migration).toContain("review.stage = 'fact'");
    expect(migration).toContain("review.stage = 'student'");
    expect(migration).toContain("review.input_content_hash = lexeme.content_hash");
    expect(migration).toContain("and issue.blocks_readiness");
  });

  it("enables RLS for every private table with no user-facing policy", () => {
    expect(migration).toContain(
      "'alter table word_index.%I enable row level security'",
    );
    expect(migration).toContain(
      "'revoke all on table word_index.%I from public, anon, authenticated'",
    );
    expect(migration).not.toMatch(
      /create\s+policy[\s\S]*word_index\./i,
    );
  });

  it("indexes nullable and non-leading foreign-key lookup columns", () => {
    const requiredIndexes = [
      "word_index_lexeme_canonical_idx",
      "word_index_etymology_lexeme_idx",
      "word_index_example_lexeme_idx",
      "word_index_example_sense_idx",
      "word_index_example_source_idx",
      "word_index_type_decision_lexeme_idx",
      "word_index_type_decision_canonical_idx",
    ];

    for (const index of requiredIndexes) {
      expect(indexMigration).toContain(`create index ${index}`);
    }
  });

  it("imports in atomic, service-role-only, idempotent batches", () => {
    expect(importMigration).toContain(
      "create table word_index.import_run (",
    );
    expect(importMigration).toContain(
      "create table word_index.import_batch (",
    );
    expect(importMigration).toContain(
      "create function private.import_word_index_batch(",
    );
    expect(importMigration).toContain(
      "received_count not between 1 and 500",
    );
    expect(importMigration).toContain(
      "existing_batch.payload_sha256 <> p_payload_sha256",
    );
    expect(importMigration).toContain(
      "get diagnostics inserted_count = row_count",
    );
    expect(importMigration).toContain(
      "grant execute on function public.import_word_index_batch(",
    );
    expect(importMigration).toContain(") to service_role;");
    expect(importMigration).toContain(
      ") from public, anon, authenticated;",
    );
  });

  it("finalizes only after every expected table and readiness count match", () => {
    expect(importMigration).toContain(
      "create function private.finalize_word_index_import(",
    );
    expect(importMigration).toContain(
      "word_index_count_mismatch: table %, expected %, actual %",
    );
    expect(importMigration).toContain(
      "word_index_readiness_mismatch: expected %, actual %",
    );
    expect(importMigration).toContain(
      "word_index_input_manifest_count_mismatch",
    );
    expect(importMigration).toContain("set status = 'complete'");
  });

  it("preserves the one raw dictionary identifier that is not a UUID", () => {
    expect(rawPointerIdentifierMigration).toContain(
      "alter column entry_uuid type text",
    );
    expect(rawPointerIdentifierMigration).toContain(
      "using entry_uuid::text",
    );
  });

  it("links each app vocabulary row to one canonical mapping state", () => {
    expect(bridgeMigration).toContain(
      "create table word_index.dataset_source (",
    );
    expect(bridgeMigration).toContain(
      "create table word_index.vocab_entry_link (",
    );
    expect(bridgeMigration).toContain(
      "create table word_index.vocab_entry_mapping_candidate (",
    );
    expect(bridgeMigration).toContain(
      "mapping_status in ('exact_headword_unreviewed', 'approved')",
    );
    expect(bridgeMigration).toContain(
      "mapping_status in ('ambiguous', 'unresolved', 'rejected')",
    );
    expect(bridgeMigration).toContain(
      "foreign key (occurrence_id, source_id, lexeme_id)",
    );
  });

  it("keeps book-meaning eligibility separate from canonical readiness", () => {
    expect(bridgeMigration).toContain(
      "create table public.vocab_dataset_capabilities (",
    );
    expect(bridgeMigration).toContain(
      "create table public.vocab_entry_quiz_eligibility (",
    );
    expect(bridgeMigration).toContain("'book_meaning_en_to_ko'");
    expect(bridgeMigration).toContain("'book_meaning_ko_to_en'");
    expect(bridgeMigration).toContain(
      "'canonical_definition_to_headword'",
    );
    expect(bridgeMigration).toContain(
      "'canonical_example_to_headword'",
    );
  });

  it("rejects cross-dataset and cross-source import rows", () => {
    expect(bridgeMigration).toContain(
      "vocab_link_occurrence_scope_mismatch",
    );
    expect(bridgeMigration).toContain(
      "vocab_entry_link_scope_mismatch",
    );
    expect(bridgeMigration).toContain(
      "vocab_entry_eligibility_scope_mismatch",
    );
    expect(bridgeMigration).toContain(
      "vocab_mapping_candidate_scope_mismatch",
    );
    expect(bridgeMigration).toContain(
      "vocab_dataset_capability_scope_mismatch",
    );
  });

  it("keeps the bridge import private, bounded, and idempotent", () => {
    expect(bridgeMigration).toContain(
      "create table word_index.vocab_link_import_batch (",
    );
    expect(bridgeMigration).toContain(
      "received_count not between 1 and 500",
    );
    expect(bridgeMigration).toContain(
      "existing_batch.payload_sha256 <> calculated_payload_sha256",
    );
    expect(bridgeMigration).toContain(
      "convert_to(p_rows::text, 'UTF8')",
    );
    expect(bridgeMigration).toContain("for share;");
    expect(bridgeMigration).toContain(
      "grant execute on function public.import_vocab_link_batch(",
    );
    expect(bridgeMigration).toContain(") to service_role;");
    expect(bridgeMigration).toContain(
      ") from public, anon, authenticated;",
    );
  });

  it("covers every bridge foreign key reported by the database advisor", () => {
    for (const index of [
      "vocab_entry_quiz_eligibility_entry_dataset_idx",
      "word_index_vocab_entry_link_dataset_source_idx",
      "word_index_vocab_entry_link_entry_dataset_idx",
    ]) {
      expect(bridgeIndexMigration).toContain(`create index ${index}`);
    }
  });
});
