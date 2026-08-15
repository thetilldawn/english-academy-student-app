begin;

do $$
begin
  if exists (
    select 1
    from public.vocab_rule_derived_korean_pronunciations
    where package_version =
      '94239160f95be4173ff3cb6b507f2244dbe56a80419b7779338af1e2494c8316'
  ) then
    raise exception 'normal_rate_stress_data_must_be_reverted_first';
  end if;
end;
$$;

create or replace function public.import_rule_derived_korean_pronunciation_package_v2(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.request_supabase_project_ref_v1() is distinct from
    'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'staging_pronunciation_import_project_mismatch'
      using errcode = '42501';
  end if;
  return private.import_rule_derived_korean_pronunciation_package_v2(
    p_package
  );
end;
$$;

revoke all on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
