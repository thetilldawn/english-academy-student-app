import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const originalMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260810123000_add_scheduled_bulk_assignment_series.sql",
  ),
  "utf8",
);
const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260821220000_extend_bulk_vocab_series_session_limit.sql",
  ),
  "utf8",
);
const workloadMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260821231500_bound_bulk_vocab_question_workload.sql",
  ),
  "utf8",
);
const studentLimitMigration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260821233000_expand_bulk_vocab_student_limit.sql",
  ),
  "utf8",
);
const persistence = fs.readFileSync(
  path.resolve(
    "src/features/assignments/server/persistence/bulk-assignment-persistence.ts",
  ),
  "utf8",
);

describe("단어 배정 연장 회차 저장 마이그레이션", () => {
  it("기존 v5를 건드리지 않고 학생별 회차 상한만 210으로 넓힌다", () => {
    expect(originalMigration).toContain(
      "(item ->> 'session_number')::integer not between 1 and 7",
    );
    expect(migration).toContain(
      "'private.create_bulk_vocab_assignments_v5(uuid,text,jsonb)'::regprocedure",
    );
    expect(migration).toContain(
      "(item ->> ''session_number'')::integer not between 1 and 210",
    );
    expect(migration).toContain(
      "(item ->> ''session_count'')::integer not between 1 and 210",
    );
    expect(migration).toContain(
      "jsonb_array_length(p_batches) not between 1 and 210",
    );
  });

  it("중복·누락·시간 역전과 원자 저장 계약이 사라지면 마이그레이션을 중단한다", () => {
    expect(migration).toContain("duplicate_bulk_assignment_series_session");
    expect(migration).toContain("incomplete_bulk_assignment_series");
    expect(migration).toContain(
      "non_increasing_bulk_assignment_series_schedule",
    );
    expect(migration).toContain("private.create_assignment_with_delivery_v7(");
    expect(migration).toContain("private.create_mixed_review_assignment_v9(");
    expect(migration).toContain("bulk_vocab_series_v5_shape_changed");
    expect(migration).toContain("bulk_vocab_series_v7_rewrite_failed");
  });

  it("v6의 학생 잠금·충돌 검사를 보존한 v8이 v7 원자 저장기로 위임한다", () => {
    expect(migration).toContain(
      "'private.create_bulk_vocab_assignments_v6(uuid,text,jsonb)'::regprocedure",
    );
    expect(migration).toContain("bulk_assignment_schedule_conflict");
    expect(migration).toContain("order by student.id");
    expect(migration).toContain("for update");
    expect(migration).toContain(
      "return private.create_bulk_vocab_assignments_v7(",
    );
    expect(migration).toContain(
      "create function public.create_bulk_vocab_assignments_v8(",
    );
    expect(migration).toContain(
      "grant execute on function public.create_bulk_vocab_assignments_v8(",
    );
    expect(persistence).toContain('"create_bulk_vocab_assignments_v11"');
  });

  it("공개 v8 경계에서 실제 문항 합계 10,000개를 넘는 요청을 막는다", () => {
    expect(workloadMigration).toContain(
      "create or replace function public.create_bulk_vocab_assignments_v8(",
    );
    expect(workloadMigration).toContain(
      "jsonb_array_length(item -> 'questions')",
    );
    expect(workloadMigration).toContain("total_question_count > 10000");
    expect(workloadMigration).toContain("bulk_question_count_exceeded");
    expect(workloadMigration).toContain("security definer");
    expect(workloadMigration.indexOf("private.is_active_admin()"))
      .toBeLessThan(workloadMigration.indexOf("jsonb_typeof(p_batches)"));
    expect(workloadMigration).toContain(
      "return private.create_bulk_vocab_assignments_v8(",
    );
  });

  it("이전 공개 저장기와 모든 내부 v1~v8 저장기를 API 역할에서 차단한다", () => {
    for (const version of [1, 2, 3, 4]) {
      expect(workloadMigration).toContain(
        `revoke all on function public.create_bulk_vocab_assignments_v${version}(`,
      );
      expect(workloadMigration).toContain(
        `revoke all on function private.create_bulk_vocab_assignments_v${version}(`,
      );
    }
    for (const version of [5, 6]) {
      expect(workloadMigration).toContain(
        `revoke all on function public.create_bulk_vocab_assignments_v${version}(`,
      );
    }
    for (const version of [5, 6, 7, 8]) {
      expect(workloadMigration).toContain(
        `revoke all on function private.create_bulk_vocab_assignments_v${version}(`,
      );
    }
    expect(workloadMigration).toContain(
      ") from public, anon, authenticated, service_role;",
    );
    expect(workloadMigration).not.toContain(
      "grant execute on function private.create_bulk_vocab_assignments_v8(",
    );
    expect(workloadMigration).toContain(
      "grant execute on function public.create_bulk_vocab_assignments_v8(",
    );
  });

  it("학생과 회차를 합쳐 210개까지 한 원자 저장 요청으로 처리한다", () => {
    expect(studentLimitMigration).toContain(
      "'private.create_bulk_vocab_assignments_v7(uuid,text,jsonb)'::regprocedure",
    );
    expect(studentLimitMigration).toContain("not between 1 and 30");
    expect(studentLimitMigration).toContain("not between 1 and 210");
    expect(studentLimitMigration).toContain(
      "bulk_vocab_student_limit_v7_rewrite_failed",
    );
  });
});
