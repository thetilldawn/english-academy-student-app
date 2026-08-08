import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808195510_add_student_reading_context_sync.sql",
  ),
  "utf8",
);

describe("student reading context sync migration", () => {
  it("tracks the immutable source request, pending hash and exclusive Drive file", () => {
    expect(migration).toContain("reading_context_latest_request_id uuid");
    expect(migration).toContain("references public.worksheet_requests(id)");
    expect(migration).toContain("reading_context_pending_sha256 text");
    expect(migration).toContain("reading_context_sync_started_at timestamptz");
    expect(migration).toContain(
      "create unique index students_reading_context_drive_file_id_idx",
    );
  });
});
