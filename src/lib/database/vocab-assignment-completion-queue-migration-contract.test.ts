import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(
    "supabase/migrations/20260822010300_add_vocab_assignment_completion_queue.sql",
  ),
  "utf8",
);

describe("단어 시험 완료 후 이어 배정 migration", () => {
  it("학생별 계획·회차·변경 이력을 비공개 표에 보존한다", () => {
    expect(migration).toContain(
      "create table private.vocab_assignment_series",
    );
    expect(migration).toContain(
      "create table private.vocab_assignment_series_items",
    );
    expect(migration).toContain(
      "create table private.vocab_assignment_series_events",
    );
    expect(migration).toContain(
      "vocab_assignment_series_items_one_live_idx",
    );
    expect(migration).toContain("where status in ('ready', 'assigned')");
    expect(migration).toContain("planned_available_from timestamptz not null");
    expect(migration).toContain("effective_available_from timestamptz not null");
    expect(migration.match(/revoke all on table private\./g)?.length)
      .toBeGreaterThanOrEqual(4);
  });

  it("실제 완료 전에는 다음 회차를 준비하지 않고 점수는 조건으로 쓰지 않는다", () => {
    expect(migration).toContain(
      "new.status in ('completed', 'expired')\n  and new.completed_at is not null",
    );
    expect(migration).toContain("if new.status = 'expired' then");
    expect(migration).toContain("set status = 'ready'");
    expect(migration).not.toMatch(/new\.passed|passing_score[^\n]*trigger/i);
  });

  it("다음 시험 생성은 service role 전용이고 재호출해도 한 회차만 활성화한다", () => {
    expect(migration).toContain(
      "create unique index vocab_assignment_series_items_one_live_idx",
    );
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain(
      "revoke all on function public.materialize_ready_vocab_assignment_queue_v1(",
    );
    expect(migration).toMatch(
      /grant execute on function public\.materialize_ready_vocab_assignment_queue_v1\([\s\S]*?\) to service_role;/,
    );
    expect(migration).not.toContain(
      "set_config('request.jwt.claim.sub'",
    );
  });

  it("지난 일정은 다음 선택 요일로 옮기고 원래 일정과 실제 일정을 모두 남긴다", () => {
    expect(migration).toContain(
      "create function private.next_vocab_assignment_queue_window_v1(",
    );
    expect(migration).toContain("if shifted_until <= new.completed_at then");
    expect(migration).toContain("effective_available_from = shifted_from");
    expect(migration).toContain("'scheduleShifted'");
  });

  it("일시적 생성 실패는 ready 상태로 남겨 다음 호출에서 재시도한다", () => {
    expect(migration).toContain(
      "if failure_reason = 'materialization_failed' then",
    );
    expect(migration).toContain("'session.materialization_failed'");
    expect(migration).toMatch(
      /if failure_reason = 'materialization_failed' then[\s\S]*?set status = 'ready'/,
    );
  });

  it("만료·취소·충돌은 확인 상태로 멈추고 관리자가 복구 방법을 고른다", () => {
    expect(migration).toContain("attention_reason = 'assignment_expired'");
    expect(migration).toContain(
      "create function public.resolve_vocab_assignment_queue_attention_v1(",
    );
    expect(migration).toContain(
      "p_action not in ('retry', 'skip', 'cancel')",
    );
    expect(migration).toContain("'session.skipped'");
    expect(migration).toContain("'series.cancelled'");
  });

  it("생성 당시 자료 release를 고정해 뒤 회차의 조용한 변경을 막는다", () => {
    expect(migration).toContain("exam_use_release_id uuid");
    expect(migration).toContain(
      "current_release_id is distinct from series_row.exam_use_release_id",
    );
    expect(migration).toContain("failure_reason := 'content_release_changed'");
  });

  it("학생별 이력은 잘라 버리지 않고 안정적인 커서로 나눠 읽는다", () => {
    expect(migration).toContain("p_student_id uuid default null");
    expect(migration).toContain("p_before_updated_at timestamptz default null");
    expect(migration).toContain("p_before_series_id uuid default null");
    expect(migration).toContain(
      "(series.updated_at, series.id) <\n          (p_before_updated_at, p_before_series_id)",
    );
    expect(migration).toContain(
      "order by series.updated_at desc, series.id desc\n    limit p_limit",
    );
    expect(migration).not.toContain("student_history_rank <= 100");
  });
});
