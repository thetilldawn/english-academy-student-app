begin;

do $$
begin
  if exists (
    select 1
    from public.vocab_rule_derived_korean_pronunciations
    where package_version =
      '8c546c01aa89ad08bf9128de4db41385fee71865fb7e4a652cc41fd1073b3d09'
  ) then
    raise exception 'production_normal_rate_stress_data_must_be_reverted_first';
  end if;
end;
$$;

-- Keep the staging wrapper from 1170 in place here. Its project-ref guard is
-- a security correction, and its atomic upgrade body is removed safely by
-- the 1160 rollback that follows in reverse migration order.

create or replace function public.import_rule_derived_korean_pronunciation_package_production_v3(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.request_supabase_project_ref_v1() is distinct from
    'xdxhswjgksukjmpbzqgz'
  then
    raise exception 'production_pronunciation_import_project_mismatch'
      using errcode = '42501';
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
