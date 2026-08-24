import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260824030000_allow_sparse_vocab_ranges_and_overlapping_schedules.sql",
  ),
  "utf8",
);

describe("비연속 단어 범위와 일정 겹침 migration 계약", () => {
  it("자료 순서가 한 방향이면 간격이 있는 단위도 허용한다", () => {
    expect(migration).toContain("if minimum_step > 0 and maximum_step > 0");
    expect(migration).toContain("if minimum_step < 0 and maximum_step < 0");
    expect(migration).toContain("assignment_unit_range_not_monotonic");
  });

  it("문항 총량 제한은 유지하면서 저장 시 일정 겹침만 차단하지 않는다", () => {
    expect(migration).toContain("bulk_question_count_exceeded");
    expect(migration).toContain(
      "return private.create_bulk_vocab_assignments_v7(",
    );
    expect(migration).toContain(
      "first_result := private.create_bulk_vocab_assignments_v7(",
    );
    expect(migration).toContain(
      "jsonb_array_length(p_series) not between 1 and 210",
    );
    expect(migration).toContain(
      "'private.create_vocab_assignment_queues_v1(uuid,text,jsonb)'::regprocedure",
    );
    expect(migration).toContain(
      "jsonb_array_length(p_series) not between 1 and 30",
    );
    expect(migration).toContain("vocab_queue_creator_shape_changed");
    expect(migration).toContain("vocab_queue_creator_overlap_rewrite_failed");
    expect(migration).toContain(
      "if false and failure_reason is null and exists (",
    );
  });

  it("비공개 범위 검사 함수는 API 역할에 열지 않는다", () => {
    expect(migration).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain("notify pgrst, 'reload schema';");
  });
});
