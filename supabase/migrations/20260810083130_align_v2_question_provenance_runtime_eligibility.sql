begin;

-- Every stage of the v2 writer must use the same runtime eligibility rule.
-- The target/choice planner already admits the two reviewed duplicate-warning
-- cases through quiz_eligibility_runtime_allowed_v1. The provenance update
-- must not fall back to the older status = 'eligible' rule.
do $migration$
declare
  function_oid regprocedure :=
    'private.create_assignment_with_question_bank_v2(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure;
  function_definition text;
  legacy_pattern constant text :=
    'and[[:space:]]+eligibility\.status[[:space:]]*=[[:space:]]*''eligible''[[:space:]]+and[[:space:]]+eligibility\.rule_version[[:space:]]*=[[:space:]]*selected_rule_version;';
  runtime_pattern constant text :=
    'and[[:space:]]+private\.quiz_eligibility_runtime_allowed_v1\(eligibility\.status,[[:space:]]*eligibility\.reason_codes\)[[:space:]]+and[[:space:]]+eligibility\.rule_version[[:space:]]*=[[:space:]]*selected_rule_version;';
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
    from regexp_matches(function_definition, legacy_pattern, 'gi')
  ) <> 1
    or (
      select count(*)
      from regexp_matches(function_definition, runtime_pattern, 'gi')
    ) <> 0
    or (
      length(function_definition) - length(replace(
        function_definition,
        'v2_question_provenance_count_mismatch',
        ''
      ))
    ) / length('v2_question_provenance_count_mismatch') <> 1
    or not security_definer_before
    or not exists (
      select 1
      from unnest(coalesce(config_before, array[]::text[])) as setting(value)
      where setting.value in ('search_path=', 'search_path=""')
    )
  then
    raise exception 'question_bank_v2_provenance_contract_changed';
  end if;

  function_definition := regexp_replace(
    function_definition,
    legacy_pattern,
    E'and private.quiz_eligibility_runtime_allowed_v1(eligibility.status, eligibility.reason_codes)\n    and eligibility.rule_version = selected_rule_version;',
    'i'
  );

  if (
    select count(*)
    from regexp_matches(function_definition, legacy_pattern, 'gi')
  ) <> 0
    or (
      select count(*)
      from regexp_matches(function_definition, runtime_pattern, 'gi')
    ) <> 1
  then
    raise exception 'question_bank_v2_provenance_rewrite_failed';
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
    raise exception 'question_bank_v2_provenance_metadata_changed';
  end if;
end;
$migration$;

revoke all on function private.create_assignment_with_question_bank_v2(
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
    'private.create_assignment_with_question_bank_v2(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure;
  function_definition text;
  runtime_pattern constant text :=
    'and[[:space:]]+private\.quiz_eligibility_runtime_allowed_v1\(eligibility\.status,[[:space:]]*eligibility\.reason_codes\)[[:space:]]+and[[:space:]]+eligibility\.rule_version[[:space:]]*=[[:space:]]*selected_rule_version;';
begin
  select pg_get_functiondef(function_oid)
  into function_definition;

  if (
    select count(*)
    from regexp_matches(function_definition, runtime_pattern, 'gi')
  ) <> 1
    or function_definition ~*
      'and[[:space:]]+eligibility\.status[[:space:]]*=[[:space:]]*''eligible''[[:space:]]+and[[:space:]]+eligibility\.rule_version'
    or not exists (
      select 1
      from pg_proc
      where oid = function_oid::oid
        and prosecdef
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
    raise exception 'question_bank_v2_provenance_contract_missing';
  end if;
end;
$migration$;

commit;
