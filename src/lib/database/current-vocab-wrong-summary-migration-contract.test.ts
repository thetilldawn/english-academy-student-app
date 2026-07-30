import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730233000_list_current_vocab_wrong_summaries.sql",
  ),
  "utf8",
);

describe("current vocabulary wrong summary migration", () => {
  it("aggregates actual wrong events with a bounded student cursor", () => {
    expect(migration).toContain(
      "public.list_student_current_vocab_wrong_summaries(",
    );
    expect(migration).toContain("p_after_student_id uuid");
    expect(migration).toContain("p_limit integer default 500");
    expect(migration).toContain(
      "p_limit not between 1 and 500",
    );
    expect(migration).toContain(
      "from public.student_vocab_wrong_events as wrong_event",
    );
    expect(migration).toContain(
      "wrong_event.canonical_lexeme_id_snapshot",
    );
    expect(migration).toContain(
      "identity.dataset_id = student.dataset_id",
    );
    expect(migration).toContain("wrong_word_count integer");
    expect(migration).toContain(
      "repeated_wrong_word_count integer",
    );
    expect(migration).toContain("left join current_words");
    expect(migration).not.toContain("student_vocab_review_queue");
  });

  it("keeps RLS active and exposes the RPC only to authenticated callers", () => {
    expect(migration).toContain("stable");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated",
    );
    expect(migration).toContain("to authenticated");
  });
});
