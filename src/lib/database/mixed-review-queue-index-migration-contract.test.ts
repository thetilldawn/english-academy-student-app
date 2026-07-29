import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730210000_index_mixed_review_queue_top_n.sql",
  ),
  "utf8",
);

describe("mixed review queue top-N index migration", () => {
  it("matches the server and RPC selection filter and order", () => {
    expect(migration).toContain(
      "student_vocab_review_queue_mixed_top_n_idx",
    );
    expect(migration).toContain("student_id,");
    expect(migration).toContain("dataset_id,");
    expect(migration).toContain("reason_level desc,");
    expect(migration).toContain("queued_at,");
    expect(migration).toContain("id");
    expect(migration).toContain("where status = 'pending'");
    expect(migration).toContain(
      "and reserved_review_draft_id is null",
    );
  });
});
