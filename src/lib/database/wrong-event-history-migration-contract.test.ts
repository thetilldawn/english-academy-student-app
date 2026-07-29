import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730130000_add_vocab_wrong_event_history.sql",
  ),
  "utf8",
);

describe("vocabulary wrong event history migration", () => {
  it("records only explicitly submitted wrong answers after an attempt finishes", () => {
    expect(migration).toContain(
      "create table public.student_vocab_wrong_events",
    );
    expect(migration).toContain(
      "unique (quiz_question_id, wrong_stage)",
    );
    expect(migration).toContain("stage.is_correct is false");
    expect(migration).not.toContain(
      "coalesce(question.retry_is_correct, false) is false",
    );
    expect(migration).toContain(
      "old.status = 'in_progress'",
    );
    expect(migration).toContain(
      "new.status in ('completed', 'expired')",
    );
    expect(migration).toContain(
      "on conflict (quiz_question_id, wrong_stage) do nothing",
    );
  });

  it("snapshots only events that predate the new attempt", () => {
    expect(migration).toContain(
      "add column prior_wrong_count integer not null default 0",
    );
    expect(migration).toContain(
      "create function private.snapshot_prior_wrong_count()",
    );
    expect(migration).toContain(
      "source_attempt.completed_at < attempt_started_at",
    );
    expect(migration).toContain(
      "before insert on public.quiz_questions",
    );
  });

  it("uses canonical identity when available and indexed occurrence fallback otherwise", () => {
    expect(migration).toContain(
      "canonical_lexeme_id_snapshot uuid",
    );
    expect(migration).toContain(
      "student_vocab_wrong_events_student_canonical_time_idx",
    );
    expect(migration).toContain(
      "wrong_event.canonical_lexeme_id_snapshot =",
    );
    expect(migration).toContain(
      "wrong_event.vocab_entry_id = new.vocab_entry_id",
    );
    expect(migration).toContain(
      "student_vocab_wrong_events_dataset_entry_idx",
    );
  });

  it("keeps the event table admin-only and immutable from the client", () => {
    expect(migration).toContain(
      "alter table public.student_vocab_wrong_events enable row level security",
    );
    expect(migration).toContain(
      'create policy "active admins can read student vocab wrong events"',
    );
    expect(migration).toContain(
      "revoke all on table public.student_vocab_wrong_events",
    );
    expect(migration).toContain(
      "grant select on table public.student_vocab_wrong_events",
    );
    expect(migration).toContain(
      "notify pgrst, 'reload schema'",
    );
  });
});
