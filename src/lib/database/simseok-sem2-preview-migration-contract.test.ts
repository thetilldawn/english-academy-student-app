import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260903190904_add_simseok_sem2_preview_vocab.sql",
  ),
  "utf8",
).replace(/\r\n/gu, "\n");

describe("심석고 2학기 Preview 자료 migration", () => {
  it("여섯 자료명과 고정 package version만 허용한다", () => {
    for (const title of [
      "[영어 II] 오선영 1과 단어",
      "[영어 II] 오선영 2과 단어",
      "[심석 고2] 2-1 모고 단어",
      "[공통영어 II] 오선영 3과 단어",
      "[공통영어 II] 오선영 4과 단어",
      "[심석 고1] 2-1 필수 형용사 500",
    ]) {
      expect(migration).toContain(`'${title}'`);
    }
    expect(migration.match(/expected_package_version := '[0-9a-f]{64}'/gu)).toHaveLength(6);
    expect(migration).toContain("expected_count := 500");
  });

  it("Preview 프로젝트와 비공식 시험범위 경계를 DB에서도 재검사한다", () => {
    expect(migration).toContain("private.request_supabase_project_ref_v1()");
    expect(migration).toContain("'wojxpruvbjzbhrpmsbuy'");
    expect(migration).toContain(
      "'user_directed_operational_scope_not_officially_confirmed'",
    );
    expect(migration).toContain("'officialSchoolRangeConfirmed', false");
    expect(migration).toContain("'productionAllowed', false");
    expect(migration).toContain("'bundleManifestSha256'");
    expect(migration).toContain(
      "create trigger app_exam_use_release_simseok_preview_guard_v1",
    );
    expect(migration).toContain(
      "raise exception 'simseok_exam_use_release_preview_only'",
    );
  });

  it("공개 가져오기는 service_role 전용이고 원시 함수는 노출하지 않는다", () => {
    expect(migration).toContain(
      "revoke all on function private.catalog_simseok_sem2_dataset_v1(uuid)\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "revoke all on function private.guard_simseok_exam_use_release_preview_v1()\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "revoke all on function public.import_simseok_exam_use_package_preview_v1(jsonb)\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "revoke all on function public.import_simseok_sem2_preview_bundle_v1(jsonb)\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.import_simseok_sem2_preview_bundle_v1(jsonb)\n  to service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.list_assignment_question_mode_availability_v1()\n  to authenticated;",
    );
    expect(migration).not.toContain(
      "grant execute on function public.import_simseok_sem2_preview_bundle_v1(jsonb)\n  to authenticated;",
    );
  });

  it("관리자에게는 데이터셋별 실제 검수 문항 수만 집계해 노출한다", () => {
    expect(migration).toContain(
      "create function public.list_assignment_question_mode_availability_v1()",
    );
    expect(migration).toContain("if not (select private.is_active_admin())");
    expect(migration).toContain(
      "count(distinct item.question_item_id) filter (",
    );
    expect(migration).toContain("release.status = 'active'");
  });

  it("여섯 자료를 한 DB 거래에서 전부 성공하거나 전부 되돌린다", () => {
    expect(migration).toContain(
      "create function public.import_simseok_sem2_preview_bundle_v1",
    );
    expect(migration).toContain(
      "jsonb_array_length(p_package_texts) is distinct from 6",
    );
    expect(migration).toContain(
      "imported_occurrence_count is distinct from 1584",
    );
    expect(migration).toContain(
      "imported := public.import_simseok_exam_use_package_preview_v1(package);",
    );
  });

  it("누락값·변조 파일·비정상 내부 결과를 fail-closed로 거부한다", () => {
    expect(migration).toContain(
      "p_package ->> 'schema_version' is distinct from '1.0'",
    );
    expect(migration).toContain(
      "p_package ->> 'target_environment' is distinct from 'preview'",
    );
    expect(migration).toContain(
      "extensions.digest(convert_to(package_text, 'UTF8'), 'sha256')",
    );
    expect(
      migration.match(/expected_package_file_sha256 :=/gu),
    ).toHaveLength(6);
    expect(migration).toContain(
      "raise exception 'invalid_simseok_preview_import_result'",
    );
  });

  it("동일 묶음 재실행은 카탈로그 행도 실제로 갱신하지 않는다", () => {
    expect(migration).toContain(
      "public.vocab_dataset_catalog.display_name",
    );
    expect(migration).toContain(
      "public.vocab_unit_catalog.catalog_group",
    );
    expect(migration.match(/is distinct from row\(/gu)).toHaveLength(2);
  });

  it("화면 이름에 연도·판본 접두어가 붙지 않도록 카탈로그 필드를 비운다", () => {
    expect(migration).toContain(
      "series_title_value, null, null, null, true, sort_index_value",
    );
    expect(migration).toContain("when unit.unit_label ~ '^DAY [0-9]{2}$' then 'day'");
    expect(migration).toContain("then 'exam_scope'");
  });
});
