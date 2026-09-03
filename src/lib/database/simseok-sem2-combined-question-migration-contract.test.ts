import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260903200316_add_simseok_sem2_definition_preview.sql",
  ),
  "utf8",
).replace(/\r\n/gu, "\n");
const timeoutMigration = readFileSync(
  resolve(
    "supabase/migrations/20260904083500_extend_simseok_question_import_timeout.sql",
  ),
  "utf8",
).replace(/\r\n/gu, "\n");

describe("심석고 통합 영영풀이·예문 Preview migration", () => {
  it("기존 OEWN v1과 새 심석 v2 release profile을 서로 위장하지 못하게 분리한다", () => {
    expect(migration).toContain("release_profile text not null default 'oewn_app_preview_v1'");
    expect(migration).toContain("release_profile = 'oewn_app_preview_v1'");
    expect(migration).toContain("release_profile = 'simseok_sem2_combined_v2'");
    expect(migration).toContain("contract = 'oewn-app-preview-question-manifest-v1'");
    expect(migration).toContain(
      "contract = 'simseok-combined-app-preview-question-package-v2'",
    );
    expect(migration).toContain("schema_version = '2.0'");
    expect(migration).toContain(
      "policy_version = 'simseok-sem2-combined-preview-v2'",
    );
  });

  it("최종 전달·검토 provenance와 여섯 package 해시를 고정한다", () => {
    for (const hash of [
      "4482b3379b9f4641d18136ccfab25fa6db206763824813a61aebf68621a8e6ff",
      "625c212c1f2a695bd0878bed9e5ea28bd50338b2692fe055e317a78df51a8ab3",
      "ccb1a8c22424c4b7f11b4eb243f2019200bda4709017b0e6f3b82fa45cbd2910",
      "a26d8d4e24455b9c41b033a0e84b604486dca1f586acad147bdd259dd5a2ff95",
      "f45a7ca5825a0b56b0fe52d9a08e2a2062a20bcf8f542f8c8bd46d14e0fa5a74",
      "5d0d372258af7ece72a01d76f8b736c7ba18fad6b4bd9c1f6e586902888871af",
      "d64564c96b01c49237cbc496a21d5246154d58e241af73e09be8285ac244cb7e",
      "7e048e336d70dfa26282e7a6a5993326a519d04a78521475d3f26acabf557807",
      "d3a4a9cb1fa422fc9a32c397bb94a5894ccaa259e0afdc5394ecbc5599b92c13",
      "46c5e9c4c808b0fc35795399fe9c390b0cf3dbe067a59e972418d96c4fea7bed",
    ]) {
      expect(migration).toContain(`'${hash}'`);
    }
    expect(migration).toContain("extensions.digest(convert_to(p_package_text, 'UTF8'), 'sha256')");
  });

  it("2개 시험 모드, prompt 모양, 새 5개 gate를 DB에서 다시 검사한다", () => {
    expect(migration).toContain("'canonical_definition_to_headword'");
    expect(migration).toContain("'canonical_example_to_headword'");
    expect(migration).toContain("position('_____' in input.item ->> 'prompt_en') <> 0");
    expect(migration).toContain("char_length(replace(input.item ->> 'prompt_en', '_____', ''))");
    for (const gate of [
      "bounded_single_answer_heuristic",
      "four_unique_choices",
      "no_synonym_gloss_or_word_family_conflict",
      "prompt_shape_valid",
      "same_part_of_speech_signature",
    ]) {
      expect(migration).toContain(`'${gate}', true`);
    }
    expect(migration).toContain("or required_gates = jsonb_build_object(");
  });

  it("mode+문항 ID LF binding과 원천 occurrence·선택지 ID를 exact하게 결속한다", () => {
    expect(migration).toContain("E'\\n' order by input.item ->> 'quiz_mode'");
    expect(migration).toContain("(input.item ->> 'question_item_id') || '|' ||");
    expect(migration).toContain("source_hash.position = source.position");
    expect(migration).toContain(
      "lower(occurrence.package_entry_content_hash) = lower(source_hash.value)",
    );
    expect(migration).toContain("choice_source_entry_ids text[]");
    expect(migration).toContain("choice_headword.position = choice_source.position");
    expect(migration).toContain("simseok_combined_question_occurrence_binding_mismatch");
    expect(migration).toContain("simseok_combined_question_choice_binding_mismatch");
  });

  it("기존 필수 review 열의 v2 호환 매핑을 명시적으로 보존한다", () => {
    expect(migration).toContain("'legacyReviewHashMapping', jsonb_build_object(");
    expect(migration).toContain("'reviewInputSha256', 'source_question_content_hash'");
    expect(migration).toContain("'reviewAuditSha256', 'content_hash'");
    expect(migration).toContain("'reviewSolverSha256', 'choice_pool_content_hash'");
    expect(migration).toContain("'reviewLevel', bound.item ->> 'review_level'");
    expect(migration).toContain("'targetPosSignature', bound.item -> 'target_pos_signature'");
  });

  it("여섯 세트를 한 RPC에서 1995/1996/942/1053으로만 확정한다", () => {
    expect(migration).toContain(
      "create function public.import_simseok_sem2_combined_question_preview_bundle_v2(",
    );
    expect(migration).toContain("jsonb_array_length(p_package_texts) is distinct from 6");
    expect(migration).toContain("imported_item_count is distinct from 1995");
    expect(migration).toContain("imported_expanded_count is distinct from 1996");
    expect(migration).toContain("imported_definition_count is distinct from 942");
    expect(migration).toContain("imported_example_count is distinct from 1053");
    expect(migration).toContain("existing_release.status = 'active'");
    expect(migration).toContain("'idempotent', true");
  });

  it("가져오기는 Preview project ref와 service_role에만 열려 있다", () => {
    expect(migration).toContain("private.request_supabase_project_ref_v1()");
    expect(migration).toContain("'wojxpruvbjzbhrpmsbuy'");
    expect(migration).toContain("'{safety,target_environment}'");
    expect(migration).toContain("'targetEnvironment', 'preview'");
    expect(migration).toContain("'sourceShadowOnly', true");
    expect(migration).toContain("'productionApplyAllowed', false");
    expect(migration).toContain(
      "revoke all on function\n  private.import_simseok_combined_question_preview_release_v2(text)\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "grant execute on function\n  public.import_simseok_sem2_combined_question_preview_bundle_v2(jsonb)\n  to service_role;",
    );
    expect(migration).not.toContain(
      "public.import_simseok_sem2_combined_question_preview_bundle_v2(jsonb)\n  to authenticated;",
    );
  });

  it("긴 원자 가져오기만 60초로 늘리고 역할·전역 제한은 바꾸지 않는다", () => {
    expect(timeoutMigration).toContain(
      "alter function public.import_simseok_sem2_combined_question_preview_bundle_v2(jsonb)\n  set statement_timeout = '60s';",
    );
    expect(timeoutMigration).toContain("notify pgrst, 'reload config';");
    expect(timeoutMigration).not.toMatch(/alter\s+role/iu);
    expect(timeoutMigration).not.toMatch(/alter\s+database/iu);
  });
});
