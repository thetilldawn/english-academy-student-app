import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829213000_add_admin_student_directory_read_model.sql",
  ),
  "utf8",
);

describe("admin student directory read migration contract", () => {
  it("관리자 security invoker 읽기 함수만 추가한다", () => {
    expect(migration.match(/create function /g)).toHaveLength(9);
    expect(migration.match(/security invoker/g)).toHaveLength(9);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(9);
    expect(migration.match(/from public, anon, authenticated, service_role/g))
      .toHaveLength(9);
    expect(migration.match(/to authenticated;/g)).toHaveLength(9);
    expect(migration.match(/private\.is_active_admin\(\)/g)).toHaveLength(9);
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).not.toMatch(/to (?:anon|service_role);/);
  });

  it("10+1 seek cursor와 page 학생 포인트 묶음 join을 사용한다", () => {
    expect(migration).toContain("p_limit not between 1 and 11");
    expect(migration).toContain("student.sort_at < p_cursor_sort_at");
    expect(migration).toContain("student.student_id > p_cursor_student_id");
    expect(migration).toContain("public.student_point_totals as point");
    expect(migration).toContain("'rawPoints', student.raw_points");
    expect(migration).not.toMatch(/greatest\([^)]*total_points/);
    expect(migration).not.toMatch(/\boffset\b/i);
    expect(migration).toContain("null,\n      'list'");
    expect(migration).toContain("max(history.effective_at) as recent_activity_at");
  });

  it("기존 이력 분류와 현재 단어장 오답 동일성 규칙을 재사용한다", () => {
    expect(migration).toContain("private.admin_history_read_rows_v1");
    expect(migration).toContain("private.vocab_identity_matches_v1");
    expect(migration).toContain("canonical_dictionary_bridge");
    expect(migration).toContain("p_wrong in ('wrong', 'repeated')");
  });

  it("선택 학생 상세와 필터 가능한 이력 10+1 계약을 분리한다", () => {
    expect(migration).toContain(
      "public.get_admin_student_detail_initial_v1",
    );
    expect(migration).toContain(
      "private.admin_student_history_filtered_rows_v1",
    );
    expect(migration).toContain(
      "public.get_admin_student_history_initial_v1",
    );
    expect(migration).toContain(
      "public.list_admin_student_history_page_v1",
    );
    expect(migration).toContain("history.effective_at < p_cursor_effective_at");
    expect(migration).toContain(
      "history.entry_key collate \"C\" > p_cursor_entry_key collate \"C\"",
    );
  });
});
