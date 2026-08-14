create or replace function private.request_supabase_project_ref_v1()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb := '{}'::jsonb;
  v_headers jsonb := '{}'::jsonb;
  v_ref text;
  v_host text;
begin
  begin
    v_claims := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_claims := '{}'::jsonb;
  end;

  v_ref := nullif(v_claims ->> 'ref', '');
  if v_ref ~ '^[a-z0-9]{20}$' then
    return v_ref;
  end if;

  begin
    v_headers := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_host := lower(split_part(
    coalesce(v_headers ->> 'x-forwarded-host', v_headers ->> 'host', ''),
    ':',
    1
  ));
  if v_host ~ '^[a-z0-9]{20}\.supabase\.co$' then
    return split_part(v_host, '.', 1);
  end if;
  return null;
end;
$$;

create or replace function public.import_rule_derived_korean_pronunciation_package_v1(
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
  return private.import_rule_derived_korean_pronunciation_package_v1(p_package);
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
  return private.import_rule_derived_korean_pronunciation_package_v2(p_package);
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

revoke all on function private.request_supabase_project_ref_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  private.import_rule_derived_korean_pronunciation_package_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  private.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  private.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_v1(jsonb)
  to service_role;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  to service_role;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_production_v3(jsonb)
  to service_role;

notify pgrst, 'reload schema';
