import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260904155047_allow_immediate_bulk_assignment_sessions.sql",
  ),
  "utf8",
);
const persistence = fs.readFileSync(
  path.resolve(
    "src/features/assignments/server/persistence/bulk-assignment-persistence.ts",
  ),
  "utf8",
);

describe("날짜 없는 여러 회차 저장 마이그레이션", () => {
  it("검증된 v10 원자 저장기를 새 v11로 복제한다", () => {
    expect(migration).toContain(
      "'private.create_bulk_vocab_assignments_v10(uuid,text,jsonb)'::regprocedure",
    );
    expect(migration).toContain(
      "private.create_bulk_vocab_assignments_v11(",
    );
    expect(migration).toContain("bulk_vocab_series_v10_shape_changed");
    expect(migration).toContain("bulk_vocab_series_v11_rewrite_failed");
    expect(migration).toContain("assignment.bulk_vocab_series_v11_created");
  });

  it("한 학생의 일정 회차와 즉시 회차를 섞지 않고 시간값을 엄격히 검사한다", () => {
    expect(migration).toContain("mixed_bulk_assignment_series_schedule");
    expect(migration).toContain("pg_catalog.isfinite");
    expect(migration).toContain("invalid_bulk_assignment_series_schedule");
    expect(migration).toContain("input.item ->> 'kind' is distinct from 'regular'");
  });

  it("관리자·작업량·멱등·재시험 설정과 최소 권한을 유지한다", () => {
    expect(migration).toContain("private.is_active_admin()");
    expect(migration).toContain("total_question_count > 10000");
    expect(migration).toContain(
      "stored_payload_sha256 is distinct from payload_sha256_value",
    );
    expect(migration).toContain("private.configure_assignment_retry_v1(");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "revoke all on function public.create_bulk_vocab_assignments_v10(",
    );
    expect(migration).toContain(
      "grant execute on function public.create_bulk_vocab_assignments_v11(",
    );
    expect(persistence).toContain('"create_bulk_vocab_assignments_v11"');
  });
});
