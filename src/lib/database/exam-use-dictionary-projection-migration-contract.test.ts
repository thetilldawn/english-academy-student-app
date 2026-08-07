import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260807033024_add_exam_use_dictionary_projection.sql",
  ),
  "utf8",
);

describe("exam-use dictionary projection migration contract", () => {
  it("공통 사전을 승격하지 않는 Preview 전용 text-ID 투영을 만든다", () => {
    expect(migration).toContain(
      "create table word_index.app_exam_use_release",
    );
    expect(migration).toContain(
      "create table word_index.app_exam_use_occurrence",
    );
    expect(migration).toContain(
      "target_environment text not null check (target_environment = 'preview')",
    );
    expect(migration).toContain("check (not common_dictionary_release_allowed)");
    expect(migration).toContain("dictionary_id text not null");
    expect(migration).toContain("[a-z0-9._''’-]*");
  });

  it("검토대기·제외 occurrence는 보존하되 public 출제 행은 만들지 않는다", () => {
    expect(migration).toContain(
      "exam_use_status in ('reviewed_for_preview', 'review_required', 'excluded')",
    );
    expect(migration).toContain("where entry.include_in_exam");
    expect(migration).toContain("and vocab_entry_id is null");
    expect(migration).toContain("and occurrence.include_in_exam");
  });

  it("import는 service role 전용이고 문제 생성은 서버에서 다시 만든다", () => {
    expect(migration).toContain(
      "create function private.import_app_exam_use_package_v1(",
    );
    expect(migration).toContain(
      "grant execute on function public.import_app_exam_use_package_v1(jsonb)\n  to service_role",
    );
    expect(migration).toContain(
      "create function private.create_assignment_with_exam_use_question_bank_v1(",
    );
    expect(migration).toContain("into trusted_questions");
    expect(migration).toContain(
      "private.create_assignment_with_question_bank(",
    );
  });

  it("v5는 release 이력이 없을 때만 v4로 되돌아가고 inactive는 차단한다", () => {
    expect(migration).toContain(
      "create function private.create_assignment_with_delivery_v5(",
    );
    expect(migration).toContain("raise exception 'exam_use_release_inactive'");
    expect(migration).toContain(
      "return private.create_assignment_with_delivery_v4(",
    );
    expect(migration).not.toContain(
      "create or replace function private.create_assignment_with_question_bank_v3(",
    );
  });

  it("배정 시점의 뜻·사전 ID·공식 음원을 별도 sidecar에 고정한다", () => {
    expect(migration).toContain(
      "create table public.assignment_question_exam_use_snapshot",
    );
    expect(migration).toContain("choice_dictionary_snapshots jsonb");
    expect(migration).toContain(
      "provenance_status = 'reviewed_for_preview_v1'",
    );
    expect(migration).toContain(
      "private.create_assignment_with_question_bank(",
    );
    expect(migration).not.toContain("question_bank_version = 3");
    expect(migration).toContain(
      "^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/",
    );
    expect(migration).toContain(
      "create table word_index.assignment_exam_use_release_snapshot",
    );
    expect(migration).toContain(
      "assignment.dictionary_exam_use_v1_preview_reviewed",
    );
    expect(migration).not.toContain(
      "assignment.dictionary_exam_use_v1_verified",
    );
  });

  it("공유 문제은행·eligibility 스키마와 기존 제약은 바꾸지 않는다", () => {
    expect(migration).not.toMatch(
      /alter table public\.(assignments|assignment_questions|vocab_entry_quiz_eligibility)/,
    );
    expect(migration).not.toMatch(/drop\s+(constraint|column|table)/i);
    expect(migration).not.toContain(
      "insert into public.vocab_entry_quiz_eligibility",
    );
    expect(migration).not.toContain(
      "insert into public.vocab_dataset_capabilities",
    );
    expect(migration).toContain(
      "create function public.list_active_exam_use_eligibility_v1(",
    );
    expect(migration).toContain(
      "raise exception 'exam_use_single_student_assignment_only'",
    );
  });

  it("스키마 캐시 갱신 뒤 트랜잭션을 닫는다", () => {
    expect(migration.trimEnd()).toMatch(
      /notify pgrst, 'reload schema';\s+commit;$/,
    );
  });
});
