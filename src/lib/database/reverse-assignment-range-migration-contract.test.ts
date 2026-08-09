import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260809120000_preserve_reverse_assignment_ranges.sql",
  ),
  "utf8",
);

describe("역방향 DAY 범위 migration 계약", () => {
  it("연속된 정방향·역방향만 허용한다", () => {
    expect(migration).toContain(
      "create function private.resolve_contiguous_unit_direction_v1(",
    );
    expect(migration).toContain("if minimum_step = 1 and maximum_step = 1");
    expect(migration).toContain("if minimum_step = -1 and maximum_step = -1");
    expect(migration).toContain("assignment_unit_range_not_contiguous");
  });

  it("고유 position 충돌 없이 전체 지원 범위를 같은 방향으로 재정렬한다", () => {
    expect(migration).toContain("set position = position + 1000000");
    expect(migration).toContain(
      "order by unit.sort_index desc, unit.id",
    );
    expect(migration).toContain(
      "assignment_primary_unit_order_mismatch",
    );
  });

  it("혼합·일괄·교체 writer의 새 버전을 제공한다", () => {
    expect(migration).toContain(
      "create function public.create_mixed_review_assignment_v9(",
    );
    expect(migration).toContain(
      "create function public.create_bulk_vocab_assignments_v4(p_batches jsonb)",
    );
    expect(migration).toContain(
      "'private.replace_student_assignment_v4('",
    );
    expect(migration).toContain(
      "create function public.replace_student_assignment_v4(",
    );
  });

  it("공개 writer는 관리자 역할만 실행하고 helper는 외부에 열지 않는다", () => {
    expect(migration).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.create_bulk_vocab_assignments_v4(jsonb)\n  to authenticated, service_role;",
    );
    expect(migration).toContain("notify pgrst, 'reload schema';");
  });

  it("배포 중 이전 활성 writer를 먼저 닫지 않는다", () => {
    expect(migration).not.toContain(
      "revoke all on function public.create_mixed_review_assignment_v8(",
    );
    expect(migration).not.toContain(
      "revoke all on function public.create_bulk_vocab_assignments_v3(jsonb)",
    );
    expect(migration).not.toContain(
      "revoke all on function public.replace_student_assignment_v3(",
    );
  });
});
