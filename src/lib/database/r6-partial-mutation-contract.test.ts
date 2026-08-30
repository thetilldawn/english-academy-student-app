import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(path.resolve("supabase/migrations", name), "utf8");
}

const history = migration(
  "20260831100000_return_admin_history_hidden_version.sql",
);
const profile = migration(
  "20260831101000_add_student_profile_version_command.sql",
);
const queue = migration(
  "20260831102000_add_atomic_vocab_queue_resolution.sql",
);

describe("R6 부분 갱신 DB 계약", () => {
  it("숨김 영수증은 저장된 DB 시각을 반환하고 기존 잠금 명령을 재사용한다", () => {
    expect(history).toContain(
      "private.hide_admin_history_entry_v1(",
    );
    expect(history).toContain("select hidden.hidden_at");
    expect(history).toContain("'hiddenAt', resolved_hidden_at");
    expect(history).toMatch(
      /revoke all on function private\.hide_admin_history_entry_v2\([\s\S]*?authenticated, service_role;/,
    );
    expect(history).toMatch(
      /grant execute on function public\.hide_admin_history_entry_v2\([\s\S]*?to authenticated;/,
    );
  });

  it("학생 프로필은 전용 버전 조건부 저장과 감사 기록을 한 함수에 둔다", () => {
    expect(profile).toContain("add column profile_updated_at timestamptz");
    expect(profile).toContain(
      "and student.profile_updated_at = p_base_version",
    );
    expect(profile).toContain("student.profile_updated_at + interval '1 microsecond'");
    expect(profile).toContain("raise exception 'student_profile_conflict'");
    expect(profile).toContain("'student.profile_updated'");
    expect(profile).toContain("public.get_admin_student_detail_initial_v2(");
    expect(profile).toContain("'updatedAt', profile_version");
    expect(profile).toMatch(
      /revoke all on function private\.update_admin_student_profile_v1\([\s\S]*?authenticated, service_role;/,
    );
    expect(profile).toMatch(
      /grant execute on function public\.update_admin_student_profile_v1\([\s\S]*?to authenticated;/,
    );
  });

  it("큐 복구는 대상 회차만 같은 트랜잭션에서 생성하고 assigned만 성공한다", () => {
    expect(queue).toContain(
      "private.resolve_vocab_assignment_queue_attention_v1(",
    );
    expect(queue).toContain(
      "private.materialize_ready_vocab_assignment_queue_v2(",
    );
    expect(queue).toContain("ready_item_id");
    expect(queue).toMatch(
      /from public\.students as student[\s\S]*?for update;[\s\S]*?private\.resolve_vocab_assignment_queue_attention_v1/,
    );
    expect(queue).toContain("materialized -> 0 ->> 'series_id'");
    expect(queue).toContain("materialized -> 0 ->> 'status' <> 'assigned'");
    expect(queue).toContain(
      "private.get_vocab_assignment_queue_summary_v1(p_series_id)",
    );
    expect(queue).toMatch(
      /revoke all on function private\.resolve_vocab_assignment_queue_attention_v2\([\s\S]*?authenticated, service_role;/,
    );
    expect(queue).toMatch(
      /grant execute on function public\.resolve_vocab_assignment_queue_attention_v2\([\s\S]*?to authenticated;/,
    );
  });
});
