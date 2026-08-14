create function private.import_rule_derived_korean_pronunciation_package_production_v3(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import_package jsonb;
  v_result jsonb;
begin
  if p_package is null
    or jsonb_typeof(p_package) is distinct from 'object'
    or p_package ->> 'schema_version' is distinct from
      'rule-derived-korean-pronunciation-batch-v1'
    or p_package ->> 'package_id' is distinct from
      'g12-long-reading-2025-rule-derived-stress-production-v3'
    or p_package ->> 'target_environment' is distinct from 'production'
    or p_package ->> 'dataset_key' is distinct from
      'g12-long-reading-2025-exam-scope-v1'
    or p_package ->> 'engine_version' is distinct from
      'cmudict-hangul-nucleus-align-v3'
    or coalesce(p_package ->> 'package_version', '') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_production_rule_derived_korean_pronunciation_package_v3'
      using errcode = '22023';
  end if;

  -- The vetted v2 importer owns the full 582-identity/601-occurrence atomic
  -- validation. Only its environment envelope is staging-specific, so keep
  -- that implementation single-sourced after validating this production-only
  -- wrapper's separate package identity and target.
  v_import_package := p_package || jsonb_build_object(
    'package_id', 'g12-long-reading-2025-rule-derived-stress-v3',
    'target_environment', 'staging'
  );
  v_result := private.import_rule_derived_korean_pronunciation_package_v2(
    v_import_package
  );
  return v_result || jsonb_build_object(
    'packageId', p_package ->> 'package_id',
    'targetEnvironment', 'production'
  );
end;
$$;

create function public.import_rule_derived_korean_pronunciation_package_production_v3(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_rule_derived_korean_pronunciation_package_production_v3(
    p_package
  );
$$;

revoke all on function
  private.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  to service_role;

notify pgrst, 'reload schema';
