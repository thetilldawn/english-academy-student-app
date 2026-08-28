import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829153000_add_admin_history_read_model.sql",
  ),
  "utf8",
);

describe("admin history read migration contract", () => {
  it("keeps all four readers invoker-only with an empty search path", () => {
    expect(migration.match(/security invoker/g)).toHaveLength(4);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(4);
    expect(migration).toContain("with admin_access as (");
    expect(migration).toContain(
      "where (select admin_access.allowed from admin_access)",
    );
  });

  it("exposes public readers only to authenticated and keeps the helper guarded", () => {
    expect(migration).toContain(
      "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function private.admin_history_read_rows_v1(",
    );
    expect(migration).toContain(
      "grant execute on function public.get_admin_history_initial_v1(",
    );
    expect(migration).toContain(
      "grant execute on function public.list_admin_history_page_v1(",
    );
    expect(migration).toContain(
      "grant execute on function public.get_admin_history_detail_v1(",
    );
    expect(migration).not.toMatch(/grant execute[\s\S]*?to service_role/);
  });

  it("does not build detail JSON on list pages and reloads the API schema", () => {
    expect(migration).toContain("p_payload text default 'list'");
    expect(migration).toContain("p_payload in ('list', 'detail')");
    expect(migration).toContain("case when p_payload = 'list'");
    expect(migration).toContain("case when p_payload = 'detail'");
    expect(migration).toContain("notify pgrst, 'reload schema';");
  });

  it("reconstructs deadline expiry before falling back to in-progress", () => {
    const unfinishedBoundary = migration.indexOf(
      "attempt.completed_at is null\n          or attempt.completed_at > p_snapshot_at",
    );
    const deadlineBoundary = migration.indexOf(
      "attempt.deadline_at <= p_snapshot_at",
      unfinishedBoundary,
    );
    const expiredProjection = migration.indexOf(
      "then 'expired'",
      deadlineBoundary,
    );
    const inProgressProjection = migration.indexOf(
      "then 'in_progress'",
      expiredProjection,
    );

    expect(unfinishedBoundary).toBeGreaterThan(-1);
    expect(deadlineBoundary).toBeGreaterThan(unfinishedBoundary);
    expect(expiredProjection).toBeGreaterThan(deadlineBoundary);
    expect(inProgressProjection).toBeGreaterThan(expiredProjection);
  });

  it("ranks the latest visible attempt after applying snapshot-time hiding", () => {
    expect(migration.match(/unhidden_rows as \(/g)).toHaveLength(2);
    const initialUnhidden = migration.indexOf("unhidden_rows as (");
    const initialRanking = migration.indexOf(
      "current_ranked as (",
      initialUnhidden,
    );
    expect(initialRanking).toBeGreaterThan(initialUnhidden);
    expect(
      migration.slice(initialUnhidden, initialRanking),
    ).toContain("where not raw.is_hidden");
  });
});
