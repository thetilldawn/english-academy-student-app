import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730153000_add_student_vocab_review_queue.sql",
  ),
  "utf8",
);

describe("student vocabulary review queue migration", () => {
  it("stores one pending queue item per exact entry or canonical word", () => {
    expect(migration).toContain(
      "create table public.student_vocab_review_queue",
    );
    expect(migration).toContain(
      "student_vocab_review_queue_pending_entry_unique",
    );
    expect(migration).toContain(
      "student_vocab_review_queue_pending_canonical_unique",
    );
    expect(migration).toContain(
      "student_vocab_review_queue_student_status_time_idx",
    );
    expect(migration).toContain(
      "status in ('pending', 'consumed', 'cancelled')",
    );
    expect(migration).toContain(
      "student_vocab_review_queue_state_check",
    );
  });

  it("accepts only distinct owned terminal wrong questions", () => {
    expect(migration).toContain(
      "cardinality(p_question_ids) not between 1 and 400",
    );
    expect(migration).toContain(
      "cardinality(p_question_ids) <>",
    );
    expect(migration).toContain("where question_id is not null");
    expect(migration).toContain("attempt.student_id = p_student_id");
    expect(migration).toContain(
      "attempt.status in ('completed', 'expired')",
    );
    expect(migration).toContain(
      "question.initial_is_correct is false",
    );
    expect(migration).toContain(
      "review_question_not_finalized_or_owned",
    );
    expect(migration).toContain(
      "inconsistent_review_word_identity",
    );
  });

  it("serializes a student's producer and merges every matching pending row", () => {
    expect(migration).toContain("student.status = 'active'");
    expect(migration).toContain("for update;");
    expect(migration).toContain(
      "status = 'cancelled'",
    );
    expect(migration).toContain(
      "cancelledDuplicateIds",
    );
    expect(migration).toContain(
      "queue.id = any(queued_ids)",
    );
    expect(migration).toContain(
      "queue.status = 'pending'",
    );
  });

  it("derives the clamped reason level from cumulative immutable history", () => {
    expect(migration).toContain(
      "from public.student_vocab_wrong_events as historical_event",
    );
    expect(migration).toContain(
      "historical_event.student_id = p_student_id",
    );
    expect(migration).toContain(
      "historical_event.canonical_lexeme_id_snapshot =",
    );
    expect(migration).toContain(
      "historical_event.vocab_entry_id =",
    );
    expect(migration).toContain("least(");
    expect(migration).toContain(")::smallint as reason_level");
  });

  it("keeps client writes behind an authenticated admin RPC", () => {
    expect(migration).toContain(
      "alter table public.student_vocab_review_queue enable row level security",
    );
    expect(migration).toContain(
      'create policy "active admins can read student vocab review queue"',
    );
    expect(migration).toContain(
      "create function private.queue_student_vocab_review_words",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "create function public.queue_student_vocab_review_words",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toMatch(
      /grant execute on function private\.queue_student_vocab_review_words\([\s\S]*?\) to authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.queue_student_vocab_review_words\([\s\S]*?\) to authenticated;/,
    );
    expect(migration).toContain(
      "revoke all on table public.student_vocab_review_queue",
    );
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});
