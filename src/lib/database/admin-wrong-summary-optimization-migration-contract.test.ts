import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260828070246_optimize_admin_wrong_summaries.sql",
  ),
  "utf8",
);

describe("admin wrong-summary optimization migration", () => {
  it("defines active review reservations once at the database read boundary", () => {
    expect(migration).toContain(
      "create view public.student_vocab_review_queue_read_v1",
    );
    expect(migration).toContain("security_invoker = true");
    expect(migration).toContain("draft.student_id = queue.student_id");
    expect(migration).toContain("draft.dataset_id = queue.dataset_id");
    expect(migration).toContain("draft.status = 'pending'");
    expect(migration).toContain(
      "draft.expires_at > transaction_timestamp()",
    );
    expect(migration).toContain("active_review_draft_id");
    expect(migration).toContain(
      "from public.student_vocab_review_queue_read_v1 as queue",
    );
    expect(migration).toContain(
      "queue.active_review_draft_id is not null",
    );
  });

  it("replaces repeated word-history lookups with one set-based pass", () => {
    expect(migration).toContain(
      "canonical_dictionary_bridge as materialized",
    );
    expect(migration).toContain(
      "initial_wrong_events as materialized",
    );
    expect(migration).toContain("word_counts as (");
    expect(migration).toContain(
      "count(distinct wrong_event.quiz_attempt_id)::integer",
    );
    expect(migration).toContain(
      "private.vocab_identity_matches_v1(",
    );
    expect(migration).not.toContain(
      "select count(distinct wrong_event.quiz_attempt_id)\n        from",
    );
  });

  it("keeps caller RLS and limits the public API to admin roles", () => {
    expect(migration.match(/security invoker/g)).toHaveLength(2);
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain("to authenticated, service_role");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});
