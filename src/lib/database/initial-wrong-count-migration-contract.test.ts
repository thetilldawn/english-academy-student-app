import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808200000_count_distinct_initial_wrong_attempts.sql",
  ),
  "utf8",
);

describe("initial wrong count migration", () => {
  it("counts one miss per completed initial-test attempt", () => {
    expect(migration).toContain(
      "count(distinct wrong_event.quiz_attempt_id)::integer",
    );
    expect(migration).toContain("wrong_event.wrong_stage = 'initial'");
    expect(migration).not.toContain("wrong_event.wrong_stage = 'retry'");
  });
});
