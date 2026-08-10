begin;

do $rollback$
declare
  function_oid regprocedure :=
    'private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure;
  function_definition text;
  current_pattern constant text :=
    'count\(DISTINCT[[:space:]]+entry\.id\)';
  legacy_pattern constant text :=
    'count\(DISTINCT[[:space:]]+entry\.headword_normalized\)';
  owner_before oid;
  acl_before aclitem[];
  security_definer_before boolean;
  config_before text[];
  return_type_before oid;
  identity_args_before text;
begin
  select replace(pg_get_functiondef(function_oid), chr(13), '')
  into function_definition;

  select
    proowner,
    proacl,
    prosecdef,
    proconfig,
    prorettype,
    pg_get_function_identity_arguments(oid)
  into
    owner_before,
    acl_before,
    security_definer_before,
    config_before,
    return_type_before,
    identity_args_before
  from pg_proc
  where oid = function_oid::oid;

  if (
    select count(*)
    from regexp_matches(function_definition, current_pattern, 'gi')
  ) <> 1
    or (
      select count(*)
      from regexp_matches(function_definition, legacy_pattern, 'gi')
    ) <> 0
    or not security_definer_before
    or not exists (
      select 1
      from unnest(coalesce(config_before, array[]::text[])) as setting(value)
      where setting.value in ('search_path=', 'search_path=""')
    )
  then
    raise exception 'assignment_occurrence_capacity_rollback_shape_changed';
  end if;

  function_definition := regexp_replace(
    function_definition,
    current_pattern,
    'count(DISTINCT entry.headword_normalized)',
    'i'
  );

  if (
    select count(*)
    from regexp_matches(function_definition, current_pattern, 'gi')
  ) <> 0
    or (
      select count(*)
      from regexp_matches(function_definition, legacy_pattern, 'gi')
    ) <> 1
  then
    raise exception 'assignment_occurrence_capacity_rollback_rewrite_failed';
  end if;

  execute function_definition;

  if not exists (
    select 1
    from pg_proc
    where oid = function_oid::oid
      and proowner = owner_before
      and proacl is not distinct from acl_before
      and prosecdef = security_definer_before
      and proconfig is not distinct from config_before
      and prorettype = return_type_before
      and pg_get_function_identity_arguments(oid) = identity_args_before
  ) then
    raise exception 'assignment_occurrence_capacity_rollback_metadata_changed';
  end if;
end;
$rollback$;

revoke all on function private.create_assignment_with_question_bank(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  uuid[],
  jsonb
) from public, anon, authenticated, service_role;

do $rollback$
declare
  function_oid regprocedure :=
    'private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure;
  function_definition text;
begin
  select pg_get_functiondef(function_oid)
  into function_definition;

  if (
    select count(*)
    from regexp_matches(
      function_definition,
      'count\(DISTINCT[[:space:]]+entry\.headword_normalized\)',
      'gi'
    )
  ) <> 1
    or function_definition ~*
      'count\(DISTINCT[[:space:]]+entry\.id\)'
    or not exists (
      select 1
      from pg_proc
      where oid = function_oid::oid
        and prosecdef
        and prorettype = 'uuid'::regtype
        and exists (
          select 1
          from unnest(coalesce(proconfig, array[]::text[])) as setting(value)
          where setting.value in ('search_path=', 'search_path=""')
        )
    )
    or has_function_privilege('anon', function_oid::oid, 'EXECUTE')
    or has_function_privilege('authenticated', function_oid::oid, 'EXECUTE')
    or has_function_privilege('service_role', function_oid::oid, 'EXECUTE')
  then
    raise exception 'assignment_occurrence_capacity_rollback_contract_missing';
  end if;
end;
$rollback$;

commit;
