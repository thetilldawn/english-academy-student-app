import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260810123000_add_scheduled_bulk_assignment_series.sql",
  ),
  "utf8",
);

describe("날짜별 다회차 일괄 배정 마이그레이션", () => {
  it("재시도 결과를 보존하는 비공개 멱등 원장을 둔다", () => {
    expect(migration).toContain(
      "create table private.bulk_vocab_series_requests",
    );
    expect(migration).toContain("idempotency_key uuid primary key");
    expect(migration).toContain("request_sha256 text not null");
    expect(migration).toContain("result jsonb");
    expect(migration).toContain(
      "create function public.get_bulk_vocab_series_result_v1(",
    );
    expect(migration).toContain("raise exception 'idempotency_key_reused'");
  });

  it("후속 일반 회차에 대기 오답을 자동 연결하지 않는다", () => {
    expect(migration).toContain(
      "private.create_assignment_with_delivery_v7(",
    );
    expect(migration).toContain("link_pending_review_targets_v2");
    expect(migration).toContain(
      "function_definition := replace(function_definition, linker_call, '');",
    );
    expect(migration).toContain(
      "created_assignment_id := private.create_assignment_with_delivery_v7(",
    );
  });

  it("같은 학생의 여러 회차를 하나의 원자적 함수에서 생성한다", () => {
    expect(migration).toContain(
      "create function public.create_bulk_vocab_assignments_v5(",
    );
    expect(migration).toContain("jsonb_array_length(p_batches) not between 1 and 210");
    expect(migration).toContain(
      "duplicate_bulk_assignment_series_session",
    );
    expect(migration).toContain("incomplete_bulk_assignment_series");
    expect(migration).toContain("item ->> 'kind' = 'mixed'");
    expect(migration).toContain("and (item ->> 'session_number')::integer <> 1");
    expect(migration).toContain("set available_from = batch_available_from");
  });

  it("미래 회차는 배정 날짜가 된 후에만 신규 알림으로 수령한다", () => {
    expect(migration).toContain(
      "assignment.available_from <= clock_timestamp()",
    );
  });

  it("공개 함수는 인증된 역할에게만 실행을 허용한다", () => {
    expect(migration).toContain(
      "revoke all on function public.create_bulk_vocab_assignments_v5(",
    );
    expect(migration).toContain("to authenticated, service_role;");
    expect(migration).toContain("if not (select private.is_active_admin())");
  });
});
