begin;

create or replace function public.import_rule_derived_korean_pronunciation_package_v2(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_count integer;
  v_old_count integer;
  v_deleted_count integer;
begin
  if private.request_supabase_project_ref_v1() is distinct from
    'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'staging_pronunciation_import_project_mismatch'
      using errcode = '42501';
  end if;

  if p_package ->> 'schema_version' =
      'rule-derived-korean-pronunciation-batch-v1'
    and p_package ->> 'package_id' =
      'g12-long-reading-2025-rule-derived-stress-v3'
    and p_package ->> 'target_environment' = 'staging'
    and p_package ->> 'dataset_key' =
      'g12-long-reading-2025-exam-scope-v1'
    and p_package ->> 'source_exam_package_version' =
      'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08'
    and p_package ->> 'source_expression_manifest_sha256' =
      '194ef0847d052b95f8f34e45623e4a484ed7b49bed6288f152eb8fdef18b5a74'
    and p_package ->> 'source_word_manifest_sha256' =
      'bf01d285b7420b117db2e65a96502886a921b7ec14f4bcda167bb7c78c6f2412'
    and p_package ->> 'source_webster_repair_sha256' =
      'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b'
    and p_package ->> 'package_version' =
      '94239160f95be4173ff3cb6b507f2244dbe56a80419b7779338af1e2494c8316'
  then
    select
      count(*),
      count(*) filter (
        where existing.package_version =
          'deff871f4828da91051cfb72eb15249cbbf0ab7f52d1df7f24db909a97813b3c'
          and existing.engine_version = 'cmudict-hangul-nucleus-align-v3'
          and existing.source_expression_manifest_sha256 =
            '770a163e8f7abf348bae75920131c9ca24a27b6017eda363626ca59e7621132e'
          and existing.source_word_manifest_sha256 =
            'c3de9146a3449a4694e5e2367b3db07ed05a4522c35616b430f5bc82f48b4714'
          and existing.source_webster_repair_sha256 =
            'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b'
          and existing.display_enabled
      )
    into v_target_count, v_old_count
    from public.vocab_rule_derived_korean_pronunciations as existing
    where existing.dataset_key = 'g12-long-reading-2025-exam-scope-v1'
      and existing.source_exam_package_version =
        'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08';

    if v_target_count = 582 and v_old_count = 582 then
      delete from public.vocab_rule_derived_korean_pronunciations
      where dataset_key = 'g12-long-reading-2025-exam-scope-v1'
        and source_exam_package_version =
          'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08';
      get diagnostics v_deleted_count = row_count;
      if v_deleted_count <> 582 then
        raise exception 'normal_rate_stress_upgrade_delete_count_mismatch'
          using errcode = '21000';
      end if;
    end if;
  end if;

  return private.import_rule_derived_korean_pronunciation_package_v2(
    p_package
  );
end;
$$;

create or replace function public.import_rule_derived_korean_pronunciation_package_production_v3(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_count integer;
  v_old_count integer;
  v_deleted_count integer;
begin
  if private.request_supabase_project_ref_v1() is distinct from
    'xdxhswjgksukjmpbzqgz'
  then
    raise exception 'production_pronunciation_import_project_mismatch'
      using errcode = '42501';
  end if;

  if p_package ->> 'schema_version' =
      'rule-derived-korean-pronunciation-batch-v1'
    and p_package ->> 'package_id' =
      'g12-long-reading-2025-rule-derived-stress-production-v3'
    and p_package ->> 'target_environment' = 'production'
    and p_package ->> 'dataset_key' =
      'g12-long-reading-2025-exam-scope-v1'
    and p_package ->> 'source_exam_package_version' =
      'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08'
    and p_package ->> 'source_expression_manifest_sha256' =
      '194ef0847d052b95f8f34e45623e4a484ed7b49bed6288f152eb8fdef18b5a74'
    and p_package ->> 'source_word_manifest_sha256' =
      'bf01d285b7420b117db2e65a96502886a921b7ec14f4bcda167bb7c78c6f2412'
    and p_package ->> 'source_webster_repair_sha256' =
      'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b'
    and p_package ->> 'package_version' =
      '8c546c01aa89ad08bf9128de4db41385fee71865fb7e4a652cc41fd1073b3d09'
  then
    select
      count(*),
      count(*) filter (
        where existing.package_version =
          'd12dfd8924d32bd1001675196747b16b3ad875959b09e67e2870f30832739405'
          and existing.engine_version = 'cmudict-hangul-nucleus-align-v3'
          and existing.source_expression_manifest_sha256 =
            '770a163e8f7abf348bae75920131c9ca24a27b6017eda363626ca59e7621132e'
          and existing.source_word_manifest_sha256 =
            'c3de9146a3449a4694e5e2367b3db07ed05a4522c35616b430f5bc82f48b4714'
          and existing.source_webster_repair_sha256 =
            'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b'
          and existing.display_enabled
      )
    into v_target_count, v_old_count
    from public.vocab_rule_derived_korean_pronunciations as existing
    where existing.dataset_key = 'g12-long-reading-2025-exam-scope-v1'
      and existing.source_exam_package_version =
        'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08';

    if v_target_count = 582 and v_old_count = 582 then
      delete from public.vocab_rule_derived_korean_pronunciations
      where dataset_key = 'g12-long-reading-2025-exam-scope-v1'
        and source_exam_package_version =
          'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08';
      get diagnostics v_deleted_count = row_count;
      if v_deleted_count <> 582 then
        raise exception 'production_normal_rate_stress_upgrade_delete_count_mismatch'
          using errcode = '21000';
      end if;
    end if;
  elsif p_package ->> 'schema_version' =
      'rule-derived-korean-pronunciation-batch-v1'
    and p_package ->> 'package_id' =
      'g12-long-reading-2025-rule-derived-stress-production-v3'
    and p_package ->> 'target_environment' = 'production'
    and p_package ->> 'dataset_key' =
      'g12-long-reading-2025-exam-scope-v1'
    and p_package ->> 'source_exam_package_version' =
      'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08'
    and p_package ->> 'source_expression_manifest_sha256' =
      '770a163e8f7abf348bae75920131c9ca24a27b6017eda363626ca59e7621132e'
    and p_package ->> 'source_word_manifest_sha256' =
      'c3de9146a3449a4694e5e2367b3db07ed05a4522c35616b430f5bc82f48b4714'
    and p_package ->> 'source_webster_repair_sha256' =
      'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b'
    and p_package ->> 'package_version' =
      'd12dfd8924d32bd1001675196747b16b3ad875959b09e67e2870f30832739405'
  then
    select
      count(*),
      count(*) filter (
        where existing.package_version =
          '8c546c01aa89ad08bf9128de4db41385fee71865fb7e4a652cc41fd1073b3d09'
          and existing.engine_version = 'cmudict-hangul-nucleus-align-v3'
          and existing.source_expression_manifest_sha256 =
            '194ef0847d052b95f8f34e45623e4a484ed7b49bed6288f152eb8fdef18b5a74'
          and existing.source_word_manifest_sha256 =
            'bf01d285b7420b117db2e65a96502886a921b7ec14f4bcda167bb7c78c6f2412'
          and existing.source_webster_repair_sha256 =
            'd57a4ba65a7bb7cfd69f68201512ae16e9b6a8ac94a31564c6f73bb8c367841b'
          and existing.display_enabled
      )
    into v_target_count, v_old_count
    from public.vocab_rule_derived_korean_pronunciations as existing
    where existing.dataset_key = 'g12-long-reading-2025-exam-scope-v1'
      and existing.source_exam_package_version =
        'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08';

    if v_target_count = 582 and v_old_count = 582 then
      delete from public.vocab_rule_derived_korean_pronunciations
      where dataset_key = 'g12-long-reading-2025-exam-scope-v1'
        and source_exam_package_version =
          'fc98d9cf6d0a688328234605377d159d50bbc51ba1c689852d657ffc95c77d08';
      get diagnostics v_deleted_count = row_count;
      if v_deleted_count <> 582 then
        raise exception 'production_stress_restore_delete_count_mismatch'
          using errcode = '21000';
      end if;
    end if;
  end if;

  return private.import_rule_derived_korean_pronunciation_package_production_v3(
    p_package
  );
end;
$$;

revoke all on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  to service_role;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
