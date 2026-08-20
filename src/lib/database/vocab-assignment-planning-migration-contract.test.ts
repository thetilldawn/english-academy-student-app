import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(
    "supabase/migrations/20260820192529_add_class_groups_and_vocab_time_templates.sql",
  ),
  "utf8",
);

describe("단어 시험 배정 준비 표 migration", () => {
  it("수업그룹과 시간 템플릿을 별도 표로 만들고 외래키를 색인한다", () => {
    expect(migration).toContain("create table public.class_groups");
    expect(migration).toContain("create table public.class_group_students");
    expect(migration).toContain(
      "create table public.admin_vocab_assignment_time_templates",
    );
    expect(migration).toContain("class_groups_created_by_idx");
    expect(migration).toContain("class_group_students_student_idx");
    expect(migration).toContain("class_group_students_created_by_idx");
    expect(migration).toContain(
      "admin_vocab_assignment_time_templates_name_idx",
    );
  });

  it("세 표 모두 RLS와 최소 관리자 권한을 명시한다", () => {
    for (const table of [
      "class_groups",
      "class_group_students",
      "admin_vocab_assignment_time_templates",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toMatch(
        new RegExp(`revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated`),
      );
    }
    expect(migration.match(/private\.is_active_admin\(\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(migration).toContain("created_by = (select auth.uid())");
  });

  it("기존 학생·시험·응시 자료를 수정하거나 지우지 않는다", () => {
    expect(migration).not.toMatch(
      /(?:update|delete from|truncate)\s+public\.(?:students|assignments|quiz_attempts)/i,
    );
  });

  it("학생 잠금 안에서 같은 날 충돌을 다시 확인한 뒤 v5 원자 저장을 호출한다", () => {
    expect(migration).toContain(
      "create function public.create_bulk_vocab_assignments_v6(",
    );
    expect(migration).toContain("order by student.id\n  for update");
    expect(migration).toContain("allowed_collision_assignment_ids");
    expect(migration).toContain("bulk_assignment_schedule_conflict");
    expect(migration).toContain("attempt.status = 'in_progress'");
    expect(migration).toContain(
      "return private.create_bulk_vocab_assignments_v5(",
    );
    expect(migration).toContain(
      "revoke all on function public.create_bulk_vocab_assignments_v6(",
    );
  });
});
