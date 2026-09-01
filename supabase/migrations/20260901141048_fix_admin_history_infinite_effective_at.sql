begin;

-- Keep the history sort/cursor timestamp finite when an untimed attempt uses
-- PostgreSQL's infinity sentinel for its deadline. Patch the existing helper
-- in place so its full read-model contract, owner, ACL, and search_path remain
-- unchanged.
do $fix_admin_history_infinite_effective_at$
declare
  target_function regprocedure :=
    'private.admin_history_read_rows_v1(timestamp with time zone,uuid,uuid,uuid,text)'::regprocedure;
  function_definition text;
  source_expression constant text :=
    'coalesce(kind.deadline_at, kind.activity_at)';
  target_expression constant text :=
    E'coalesce(\n'
    || E'            case\n'
    || E'              when pg_catalog.isfinite(kind.deadline_at)\n'
    || E'                then kind.deadline_at\n'
    || E'            end,\n'
    || E'            case\n'
    || E'              when pg_catalog.isfinite(kind.completed_at)\n'
    || E'                then kind.completed_at\n'
    || E'            end,\n'
    || E'            kind.activity_at\n'
    || E'          )';
  owner_before oid;
  acl_before aclitem[];
  security_definer_before boolean;
  config_before text[];
begin
  select replace(pg_get_functiondef(target_function), chr(13), '')
  into function_definition;

  select proowner, proacl, prosecdef, proconfig
  into owner_before, acl_before, security_definer_before, config_before
  from pg_proc
  where oid = target_function::oid;

  if (
    length(function_definition)
    - length(replace(function_definition, source_expression, ''))
  ) / length(source_expression) <> 1
    or position('pg_catalog.isfinite(kind.deadline_at)' in function_definition) <> 0
    or security_definer_before
    or not exists (
      select 1
      from unnest(coalesce(config_before, array[]::text[])) as setting(value)
      where setting.value in ('search_path=', 'search_path=""')
    )
  then
    raise exception 'admin_history_effective_at_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    source_expression,
    target_expression
  );
  if position(source_expression in function_definition) <> 0
    or position(target_expression in function_definition) = 0
  then
    raise exception 'admin_history_effective_at_rewrite_failed';
  end if;
  execute function_definition;

  if not exists (
    select 1
    from pg_proc
    where oid = target_function::oid
      and proowner = owner_before
      and proacl is not distinct from acl_before
      and prosecdef = security_definer_before
      and proconfig is not distinct from config_before
      and position(
        'pg_catalog.isfinite(kind.deadline_at)'
        in pg_get_functiondef(target_function)
      ) > 0
      and position(
        'pg_catalog.isfinite(kind.completed_at)'
        in pg_get_functiondef(target_function)
      ) > 0
  ) then
    raise exception 'admin_history_effective_at_metadata_changed';
  end if;
end;
$fix_admin_history_infinite_effective_at$;

revoke all on function private.admin_history_read_rows_v1(
  timestamptz, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function private.admin_history_read_rows_v1(
  timestamptz, uuid, uuid, uuid, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
