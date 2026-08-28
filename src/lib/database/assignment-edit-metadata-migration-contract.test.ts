import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260828193000_preserve_assignment_edit_metadata.sql",
  ),
  "utf8",
);

describe("assignment edit metadata migration contract", () => {
  it("runs the trigger disable and backfill work atomically", () => {
    expect(migration).toMatch(/\bbegin;[\s\S]*\bcommit;/);
  });

  it("persists review scope and stops when legacy provenance is ambiguous", () => {
    expect(migration).toContain("add column review_scope text");
    expect(migration).toContain("assignment_review_scope_provenance_missing");
    expect(migration).toContain(
      "alter column review_scope set not null",
    );
    expect(migration).toContain(
      "create or replace function private.create_mixed_review_assignment_v9(",
    );
    expect(migration).toContain(
      "create or replace function public.create_mixed_review_assignment_v8(",
    );
  });

  it("binds replacement lookup to all edit-only metadata and keeps the raw recovery hash", () => {
    expect(migration).toContain(
      "private.bind_assignment_replacement_request_sha_v2(",
    );
    expect(migration).toContain(
      "create function public.get_student_assignment_replacement_result_v2(",
    );
    expect(migration).toContain(
      "create or replace function public.get_student_assignment_replacement_result_v1(",
    );
    expect(migration).toContain("'availableFrom', p_available_from");
    expect(migration).toContain("'reviewScope', p_review_scope");
    expect(migration).toContain("'retryEnabled', p_retry_enabled");
    expect(migration).toContain("client_request_sha256");
  });

  it("preserves source purpose and reconnects an edited queued session", () => {
    expect(migration).toContain(
      "create function public.replace_student_assignment_v6(",
    );
    expect(migration).toContain(
      "p_replacement_kind is distinct from source_purpose",
    );
    expect(migration).toContain("assignment_edit_field_locked");
    expect(migration).toContain(
      "assignment_id = replacement_assignment_id",
    );
    expect(migration).toContain(
      "effective_available_from = p_available_from",
    );
    expect(migration).toContain("vocab_assignment_series_schedule_required");
    expect(migration).toContain("'session.replaced'");
    expect(migration).toContain("vocab_assignment_series_rebind_mismatch");
    expect(migration.indexOf("from public.students as student")).toBeLessThan(
      migration.indexOf("for update of item, series"),
    );
  });

  it("retires direct access to the superseded replacement writers", () => {
    expect(migration).toContain(
      "revoke all on function private.replace_student_assignment_v3(",
    );
    expect(migration).toContain(
      "revoke all on function public.replace_student_assignment_v3(",
    );
    expect(migration).toContain(
      "revoke all on function private.replace_student_assignment_v4(",
    );
    expect(migration).toContain(
      "revoke all on function public.replace_student_assignment_v4(",
    );
    expect(migration).toContain(
      "create or replace function public.replace_student_assignment_v5(",
    );
    expect(migration).toContain(
      "grant execute on function public.replace_student_assignment_v5(",
    );
    expect(migration).toContain(
      "grant execute on function public.replace_student_assignment_v6(",
    );
  });
});
