import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260822010400_finalize_expired_unanswered_as_wrong.sql",
  ),
  "utf8",
);

describe("expired unanswered finalization migration", () => {
  it("normalizes unanswered stages before deriving scores and state", () => {
    const normalizeAt = migration.indexOf("set initial_is_correct = false");
    const aggregateAt = migration.indexOf("count(*) filter (where initial_is_correct is true)");
    const finalizeAt = migration.indexOf("set status = 'expired'");

    expect(normalizeAt).toBeGreaterThan(0);
    expect(aggregateAt).toBeGreaterThan(normalizeAt);
    expect(finalizeAt).toBeGreaterThan(aggregateAt);
    expect(migration).toContain("initial_timed_out = true");
    expect(migration).toContain("retry_timed_out = true");
    expect(migration).not.toContain("and initial_choice_index is not null");
    expect(migration).toContain(
      "state_evaluation_time := attempt_row.deadline_at",
    );
  });
});
