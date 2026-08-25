import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260825083542_add_student_point_ledger.sql",
  ),
  "utf8",
);

describe("student point ledger migration contract", () => {
  it("starts new attempts on v1 without backfilling historical attempts", () => {
    const addColumn = migration.indexOf(
      "add column point_rule_version_snapshot text",
    );
    const setDefault = migration.indexOf(
      "set default 'vocab-points-v1'",
    );

    expect(addColumn).toBeGreaterThan(-1);
    expect(setDefault).toBeGreaterThan(addColumn);
    expect(migration).not.toMatch(
      /update public\.quiz_attempts[\s\S]*point_rule_version_snapshot/i,
    );
    expect(migration).toContain(
      "create trigger quiz_attempts_default_point_rule_snapshot",
    );
    expect(migration).toContain(
      "new.point_rule_version_snapshot := 'vocab-points-v1'",
    );
    expect(migration).toContain(
      "create trigger quiz_attempts_preserve_point_rule_snapshot",
    );
    expect(migration).toContain("point_rule_snapshot_is_immutable");
  });

  it("keeps an append-only ledger and an atomic student total", () => {
    expect(migration).toContain("create table public.student_point_events");
    expect(migration).toContain("create table public.student_point_totals");
    expect(migration).toContain(
      "create unique index student_point_events_quiz_question_stage_unique",
    );
    expect(migration).toContain("where event_kind = 'quiz_outcome'");
    expect(migration).toContain("on conflict do nothing");
    expect(migration).toContain(
      "referencing new table as inserted_point_events",
    );
    expect(migration).toContain("point_events_are_append_only");
    expect(migration).not.toMatch(
      /quiz_attempt_id uuid[^,]*references public\.quiz_attempts/i,
    );
    expect(migration).not.toMatch(
      /quiz_question_id uuid[^,]*references public\.quiz_questions/i,
    );
  });

  it("fixes the eight v1 outcomes including zero-point events", () => {
    expect(migration).toContain("create function private.vocab_quiz_point_delta_v1");
    expect(migration).toContain("then -3");
    expect(migration.match(/then 2/g)).toHaveLength(3);
    expect(migration).toContain("then 1");
    expect(migration.match(/then 0/g)).toHaveLength(3);
    expect(migration).toContain("stage.is_correct is not null");
    expect(migration).toContain("when stage.choice_index is null then 'unanswered'::text");
    expect(migration).toContain("when stage.timed_out then 'timeout'::text");
    expect(migration).toContain(
      "delta = private.vocab_quiz_point_delta_v1",
    );
  });

  it("records only at the initial-review or terminal attempt boundary", () => {
    expect(migration).toContain(
      "create constraint trigger quiz_attempts_record_student_point_events",
    );
    expect(migration).toContain("deferrable initially deferred");
    expect(migration).toContain("old.phase = 'initial'");
    expect(migration).toContain("new.phase = 'review'");
    expect(migration).toContain("old.status = 'in_progress'");
    expect(migration).toContain("new.status in ('completed', 'expired')");
    expect(migration).toContain(
      "review_target.assignment_question_id =",
    );
    expect(migration).toContain("assignment.assignment_purpose = 'review'");
  });

  it("allows reads but blocks direct application writes", () => {
    expect(migration).toContain(
      'create policy "active admins can read student point events"',
    );
    expect(migration).toContain(
      'create policy "active admins can read student point totals"',
    );
    expect(migration).toContain(
      "revoke all on table public.student_point_events",
    );
    expect(migration).toContain(
      "revoke all on table public.student_point_totals",
    );
    expect(migration).toContain(
      "grant select on table public.student_point_events",
    );
    expect(migration).toContain(
      "grant select on table public.student_point_totals",
    );
    expect(migration).toContain(
      "revoke all on sequence public.student_point_events_id_seq",
    );
  });
});
