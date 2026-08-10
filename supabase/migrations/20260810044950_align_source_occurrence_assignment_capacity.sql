begin;

-- Assignment targets are source occurrences (`vocab_entries.id`). Repeated
-- lexical headwords in different DAY rows remain distinct assignment targets.
do $migration$
declare
  function_oid regprocedure :=
    'private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure;
  function_definition text;
  old_pattern constant text :=
    'count\(DISTINCT[[:space:]]+entry\.headword_normalized\)';
  new_pattern constant text :=
    'count\(DISTINCT[[:space:]]+entry\.id\)';
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
    from regexp_matches(function_definition, old_pattern, 'gi')
  ) <> 1
    or (
      select count(*)
      from regexp_matches(function_definition, new_pattern, 'gi')
    ) <> 0
    or (
      length(function_definition) - length(replace(
        function_definition,
        'p_question_count not between 1 and 500',
        ''
      ))
    ) / length('p_question_count not between 1 and 500') <> 1
    or position('private.is_active_admin()' in function_definition) = 0
    or not security_definer_before
    or not exists (
      select 1
      from unnest(coalesce(config_before, array[]::text[])) as setting(value)
      where setting.value in ('search_path=', 'search_path=""')
    )
  then
    raise exception 'assignment_occurrence_writer_contract_changed';
  end if;

  function_definition := regexp_replace(
    function_definition,
    old_pattern,
    'count(DISTINCT entry.id)',
    'i'
  );

  if (
    select count(*)
    from regexp_matches(function_definition, old_pattern, 'gi')
  ) <> 0
    or (
      select count(*)
      from regexp_matches(function_definition, new_pattern, 'gi')
    ) <> 1
  then
    raise exception 'assignment_occurrence_capacity_rewrite_failed';
  end if;

  -- pg_get_functiondef preserves the current reviewed body and attributes.
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
    raise exception 'assignment_occurrence_writer_metadata_changed';
  end if;
end;
$migration$;

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

do $migration$
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
      'count\(DISTINCT[[:space:]]+entry\.id\)',
      'gi'
    )
  ) <> 1
    or function_definition ~*
      'count\(DISTINCT[[:space:]]+entry\.headword_normalized\)'
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
    raise exception 'assignment_occurrence_capacity_contract_missing';
  end if;
end;
$migration$;

commit;
