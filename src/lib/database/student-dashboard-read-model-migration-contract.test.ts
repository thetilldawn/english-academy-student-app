import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829190000_add_student_dashboard_read_model.sql",
  ),
  "utf8",
);

describe("student dashboard read migration contract", () => {
  it("내부 투영 하나와 공개 읽기 두 개만 service role 전용으로 둔다", () => {
    expect(migration.match(/create function /g)).toHaveLength(3);
    expect(migration.match(/security invoker/g)).toHaveLength(3);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(3);
    expect(migration.match(/to service_role;/g)).toHaveLength(3);
    expect(migration.match(/from public, anon, authenticated, service_role/g))
      .toHaveLength(3);
    expect(migration).not.toMatch(/to (?:anon|authenticated);/);
  });

  it("공통 투영 한 번에서 현재 목록, 완료 10+1, 다섯 개수를 계산한다", () => {
    expect(migration).toContain("dashboard_rows as materialized");
    expect(migration).toContain("limit 11");
    for (const section of [
      "open",
      "scheduled",
      "needs_attention",
      "completed",
      "deadline_closed",
    ]) {
      expect(migration).toContain(`row.dashboard_section = '${section}'`);
    }
    expect(migration).toContain("'dashboardSection', row.dashboard_section");
  });

  it("응시 당시 문항·통과 기준과 유한한 마감만 화면에 투영한다", () => {
    expect(migration).toContain("attempt.question_count_snapshot");
    expect(migration).toContain("attempt.passing_score_snapshot");
    expect(migration).toContain("attempt.retry_passing_score_snapshot");
    expect(migration).toContain("projected.projected_passing_score");
    expect(migration).toContain("not isfinite(base.deadline_at)");
  });

  it("snapshot과 복합 커서를 검증하고 offset 없이 정렬한다", () => {
    expect(migration).toContain("errcode = '22023'");
    expect(migration).toContain("p_cursor_effective_at > p_snapshot_at");
    expect(migration).toContain("row.effective_at < p_cursor_effective_at");
    expect(migration).toContain("row.assignment_id > p_cursor_assignment_id");
    expect(migration).not.toMatch(/\boffset\b/i);
  });
});

