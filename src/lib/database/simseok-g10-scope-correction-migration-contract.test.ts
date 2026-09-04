import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260904021927_correct_simseok_g10_preview_scope.sql",
  ),
  "utf8",
).replace(/\r\n/gu, "\n");

describe("심석고 고1 공통영어Ⅱ 1·2과 Preview 정정 migration", () => {
  it("정정 전용 profile을 추가하되 기존 OEWN·심석 v2 제약을 보존한다", () => {
    for (const profile of [
      "release_profile = 'oewn_app_preview_v1'",
      "release_profile = 'simseok_sem2_combined_v2'",
      "release_profile = 'simseok_g10_scope_correction_v3'",
    ]) {
      expect(migration).toContain(profile);
    }
    expect(migration).toMatch(
      /policy_version\s*=\s*\n?\s*'simseok-sem2-combined-preview-v3-g1-lessons-1-2'/u,
    );
  });

  it("새 고1 1·2과의 exam·question 고정 해시와 정확한 수치를 DB에서도 검사한다", () => {
    for (const value of [
      "2bd1365075c0a7d3c4c0c47f397b385e90c0b5ea7d98e8ebf6798d0b2d110a54",
      "4e7289e2d750614b057c83e0fef7c503a56f6bf7b80b211ce47621f12906af38",
      "744d4f60b2bf9795f319a942f3ff38b2e276fea031867814039e49237a9ce086",
      "5a3d3460bf435c8f6cb3a54934319ebbf89435b864ba9b7ec77b9ca0ce6e28cf",
      "16d754616e2945c603eb0d4c87f68d51ab59b2838bc290363aa23dafc2d98aeb",
      "33496efb466d4c969da2e44de66921638168a7088f11d21c0ad70eebadd64b5a",
      "2de8bbcde065ccd0322ea3a0d57af3bed5f518d9588710dbc97b297bcb3252d3",
      "536f2beedec9b4a428cd87a11c7c4df310e890905184499e2ce35ffe81088cc5",
      "76385cb902e0352389ec958d75b948d4460a1f79ac97204895a978646791cd54",
      "4ffc47956d1f3e02514389c8194ded87f22cf91886298d392f09fadcee6a1693",
      "4ffc2e1bc3c1fd62747b2564dd948a8520b8693bb7ce965e891b790b7652c977",
      "adb5acfe4d1abb8d69be11c04ef56c820e50598bbed8ac8fe2ad02d6f2fc35af",
      "84e027b5854b1239b55ec62a8ba6100cf4f83e53cde040aecafec0d3b29be6b1",
    ]) {
      expect(migration.toLowerCase()).toContain(`'${value}'`);
    }
    expect(migration.match(/expected_count := 111/gu)).toHaveLength(2);
    expect(migration).toContain("expected_item_count := 117");
    expect(migration).toContain("expected_item_count := 128");
    expect(migration).toContain("question_item_count is distinct from 245");
    expect(migration).toContain("question_expanded_count is distinct from 249");
  });

  it("기존 고2 세 자료와 고1 형용사 500은 v2 지문 그대로인지 검산한다", () => {
    for (const value of [
      "27c2f468eb54089bf21c15e927d200e856791afd42e8f3d8a95f12e69d32dfbb",
      "f45a7ca5825a0b56b0fe52d9a08e2a2062a20bcf8f542f8c8bd46d14e0fa5a74",
      "d86fab7e25387740cb0ab37269301c6fdb3894103d17572da8aebdafd5853bd0",
      "5d0d372258af7ece72a01d76f8b736c7ba18fad6b4bd9c1f6e586902888871af",
      "120b72270326702cbeff4294e097ee9ee45e7e678e564b18bb6db2ac52c0fa9c",
      "d64564c96b01c49237cbc496a21d5246154d58e241af73e09be8285ac244cb7e",
      "95e4e029e33e15930cbe84fe64be91d3d2b9ca8b64027373adfd26e6fe717a4e",
      "46c5e9c4c808b0fc35795399fe9c390b0cf3dbe067a59e972418d96c4fea7bed",
    ]) {
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).toContain("unaffected_count is distinct from 4");
    expect(
      migration.match(
        /select count\(\*\) from word_index\.app_exam_use_occurrence occurrence/gu,
      )?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      migration.match(
        /question_release\.exam_use_release_id = exam_release\.release_id/gu,
      )?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("stage는 신규 두 세트를 배정 불가·검토 대기·문항 loading으로 숨긴다", () => {
    expect(migration).toContain(
      "private.catalog_simseok_g10_scope_correction_dataset_v3(\n    dataset_id_value,\n    false\n  )",
    );
    expect(migration).toContain(
      "series_title_value, null, null, null, p_assignable, sort_index_value",
    );
    expect(migration).toContain("set status = 'pending_review',\n      is_active = false");
    expect(migration).toContain("question_release.status = 'loading'");
    expect(migration).toContain("not catalog.is_assignable");
  });

  it("컷오버 전 기존 3·4과 업무 참조를 0건으로 재검사한다", () => {
    for (const table of [
      "public.students",
      "public.assignments",
      "public.student_vocab_state",
      "public.student_vocab_wrong_events",
      "public.student_vocab_review_queue",
      "public.student_vocab_review_assignment_drafts",
      "public.assignment_review_targets",
      "public.worksheet_request_items",
      "public.student_learning_sources",
      "private.current_wrong_review_assignment_requests",
      "private.vocab_assignment_series",
      "public.assignment_question_exam_use_snapshot",
      "word_index.assignment_exam_use_release_snapshot",
    ]) {
      expect(migration).toContain(`from ${table}`);
    }
    expect(migration).toContain(
      "simseok_g10_scope_correction_old_dataset_references_exist",
    );
  });

  it("한 RPC에서 기존 3·4과를 보존한 채 retire하고 신규 1·2과만 활성화한다", () => {
    expect(migration).toContain(
      "create function public.cutover_simseok_g10_scope_correction_preview_v3()",
    );
    expect(migration).toContain("set is_assignable = false");
    expect(migration).toContain("set status = 'retired', retired_at_utc");
    expect(migration).toContain("set status = 'retired', is_active = false");
    expect(migration).toContain("set status = 'ready', is_active = true");
    expect(migration).toContain("set is_assignable = true");
    expect(migration).toContain("set status = 'active', activated_at_utc");
    expect(migration).not.toMatch(/\bdelete\s+from\b/iu);
  });

  it("Preview ref와 service_role만 허용하고 긴 stage 함수 하나만 60초로 제한한다", () => {
    expect(migration).toContain("'wojxpruvbjzbhrpmsbuy'");
    for (const signature of [
      "public.stage_simseok_g10_scope_correction_preview_v3(jsonb, jsonb)",
      "public.preflight_simseok_g10_scope_correction_preview_v3()",
      "public.cutover_simseok_g10_scope_correction_preview_v3()",
    ]) {
      expect(migration).toContain(
        `revoke all on function ${signature} from public, anon, authenticated, service_role;`,
      );
      expect(migration).toContain(
        `grant execute on function ${signature} to service_role;`,
      );
      expect(migration).not.toContain(
        `grant execute on function ${signature} to authenticated;`,
      );
    }
    expect(migration).toContain(
      "alter function public.stage_simseok_g10_scope_correction_preview_v3(jsonb, jsonb)\n  set statement_timeout = '60s';",
    );
    expect(migration).not.toMatch(/alter\s+role/iu);
    expect(migration).not.toMatch(/alter\s+database/iu);
    expect(
      migration.match(
        /coalesce\([^\n]*sha256 ~ '\^\[0-9a-f\]\{64\}\$', false\)/gu,
      )?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("최종 활성 합계를 6세트·1509 occurrence·1766/1771 문항으로 고정한다", () => {
    for (const fragment of [
      "'activeDatasetCount', 6",
      "'activeOccurrenceCount', 1509",
      "'activeItemCount', 1766",
      "'activeExpandedCount', 1771",
      "'activeDefinitionCount', 840",
      "'activeExampleCount', 926",
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).toContain("if before_state ->> 'status' = 'active' then");
    expect(migration).toContain("jsonb_build_object('idempotent', true)");
  });
});
