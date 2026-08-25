import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260825085507_add_student_point_reads.sql",
  ),
  "utf8",
);

describe("student point read migration contract", () => {
  it("returns every requested student with a non-negative current value", () => {
    expect(migration).toContain(
      "create function public.list_student_point_totals_v1",
    );
    expect(migration).toContain(
      "unnest(coalesce(p_student_ids, '{}'::uuid[]))",
    );
    expect(migration).toContain(
      "left join public.student_point_totals as total",
    );
    expect(migration).toContain(
      "greatest(coalesce(total.total_points, 0::bigint), 0::bigint)",
    );
  });

  it("aggregates one attempt without confusing no events with a zero delta", () => {
    expect(migration).toContain(
      "create function public.get_quiz_attempt_point_summary_v1",
    );
    expect(migration).toContain("count(*)::bigint as event_count");
    expect(migration).toContain(
      "sum(event.delta) filter (where event.delta > 0)",
    );
    expect(migration).toContain(
      "sum(event.delta) filter (where event.delta < 0)",
    );
    expect(migration).toContain("coalesce(sum(event.delta), 0::bigint)");
    expect(migration).toContain("event.quiz_attempt_id = p_attempt_id");
    expect(migration).toContain("event.event_kind = 'quiz_outcome'");
  });

  it("uses invoker rights and exposes both functions only to the server role", () => {
    expect(migration.match(/security invoker/g)).toHaveLength(2);
    expect(migration).toContain(
      "revoke all on function public.list_student_point_totals_v1(uuid[])",
    );
    expect(migration).toContain(
      "revoke all on function public.get_quiz_attempt_point_summary_v1(uuid, uuid)",
    );
    expect(migration.match(/to service_role;/g)).toHaveLength(2);
    expect(migration).not.toContain("to authenticated;");
    expect(migration).not.toContain("security definer");
  });
});
