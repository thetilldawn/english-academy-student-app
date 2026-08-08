import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808010555_wrong_word_worksheet_requests.sql",
  ),
  "utf8",
);

const indexMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808015000_index_wrong_word_worksheet_foreign_keys.sql",
  ),
  "utf8",
);

const compositeIndexMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808015500_cover_wrong_word_worksheet_composite_fk.sql",
  ),
  "utf8",
);

describe("wrong-word worksheet migration contract", () => {
  it("keeps the private request and occurrence snapshot separate", () => {
    expect(migration).toContain("create table public.worksheet_requests");
    expect(migration).toContain(
      "create table public.worksheet_request_items",
    );
    expect(migration).toContain("primary_wrong_event_id bigint not null");
    expect(migration).toContain("dictionary_id_snapshot text");
    expect(migration).toContain("sense_id_snapshot text");
    expect(migration).toContain("occurrence_id_snapshot text");
    expect(migration).toContain("generation_status in (");
    expect(migration).toContain("'needs_dictionary_link'");
    expect(migration).toContain("'needs_meaning_review'");
  });

  it("uses identity-only idempotency and export-visible content hashing", () => {
    expect(migration).toContain("'itemIdentities', identity_snapshot");
    expect(migration).toContain("'exportItem', jsonb_build_object(");
    expect(migration).toContain("'items', export_snapshot");
    expect(migration).not.toContain("'snapshotHash', snapshot_hash");
    expect(migration).not.toContain("'metadata', dataset.metadata");
    expect(migration).toContain(
      "wrong_event.dataset_id = entry.dataset_id",
    );
    expect(migration).toContain(
      "wrong_event.vocab_entry_id = entry.id",
    );
  });

  it("requires an active admin and explicit table/function privileges", () => {
    expect(migration.match(/private\.is_active_admin\(\)/g)).toHaveLength(4);
    expect(migration).toContain(
      "alter table public.worksheet_requests enable row level security",
    );
    expect(migration).toContain(
      "alter table public.worksheet_request_items enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.worksheet_requests",
    );
    expect(migration).toContain(
      "revoke all on function public.create_wrong_word_worksheet_request_v1",
    );
    expect(migration).toContain(
      "grant execute on function public.export_wrong_word_worksheet_request_v1",
    );
  });

  it("covers worksheet foreign keys used by deletes and joins", () => {
    expect(indexMigration).toContain("worksheet_requests_requested_by_idx");
    expect(indexMigration).toContain("worksheet_request_items_wrong_event_idx");
    expect(indexMigration).toContain("worksheet_request_items_dataset_entry_idx");
    expect(indexMigration).toContain("(dataset_id, vocab_entry_id)");
    expect(compositeIndexMigration).toContain(
      "worksheet_request_items_entry_dataset_idx",
    );
    expect(compositeIndexMigration).toContain("(vocab_entry_id, dataset_id)");
  });

  it("exports a traceable but name-free packet and audits each download", () => {
    expect(migration).toContain("'student_id', request.student_id");
    expect(migration).toContain("'school_name', request.school_name_snapshot");
    expect(migration).not.toContain("'student_name'");
    expect(migration).not.toContain("display_name_snapshot");
    expect(migration).toContain("'worksheet.wrong_word.exported'");
    expect(migration).toContain(
      "request.status in ('queued', 'generated', 'approved')",
    );
  });
});
