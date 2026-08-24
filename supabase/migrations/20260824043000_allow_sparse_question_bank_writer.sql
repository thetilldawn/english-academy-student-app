begin;

-- The question-bank writer still carried the original contiguous-unit guard.
-- Reuse the reviewed direction resolver so a teacher can select separate units
-- from one dataset while duplicates, foreign units, and direction changes stay
-- invalid. Preserve every other writer guard and all function metadata.
do $migration$
declare
  function_oid regprocedure :=
    'private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure;
  function_definition text;
  old_guard constant text := E'  if selected_unit_count <> last_unit_sort - first_unit_sort + 1 then\n    raise exception ''units_must_be_contiguous'' using errcode = ''22023'';\n  end if;';
  new_guard constant text := E'  perform private.resolve_contiguous_unit_direction_v1(\n    p_dataset_id,\n    p_unit_ids\n  );';
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
    length(function_definition) - length(replace(
      function_definition,
      old_guard,
      ''
    ))
  ) / length(old_guard) <> 1
    or position(new_guard in function_definition) > 0
    or position('private.is_active_admin()' in function_definition) = 0
    or position('p_question_count not between 1 and 500' in function_definition) = 0
    or not security_definer_before
    or not exists (
      select 1
      from unnest(coalesce(config_before, array[]::text[])) as setting(value)
      where setting.value in ('search_path=', 'search_path=""')
    )
  then
    raise exception 'sparse_question_bank_writer_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    old_guard,
    new_guard
  );

  if position(old_guard in function_definition) > 0
    or position(new_guard in function_definition) = 0
    or position('units_must_be_contiguous' in function_definition) > 0
  then
    raise exception 'sparse_question_bank_writer_rewrite_failed';
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
    raise exception 'sparse_question_bank_writer_metadata_changed';
  end if;
end;
$migration$;

-- Completion-triggered queue materialization uses an explicit-admin clone of
-- the same writer. Apply the identical narrow rewrite there so later sessions
-- do not fail after the first sparse assignment completes.
do $migration$
declare
  function_oid regprocedure :=
    'private.create_assignment_with_question_bank_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure;
  function_definition text;
  old_guard constant text := E'  if selected_unit_count <> last_unit_sort - first_unit_sort + 1 then\n    raise exception ''units_must_be_contiguous'' using errcode = ''22023'';\n  end if;';
  new_guard constant text := E'  perform private.resolve_contiguous_unit_direction_v1(\n    p_dataset_id,\n    p_unit_ids\n  );';
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
    length(function_definition) - length(replace(
      function_definition,
      old_guard,
      ''
    ))
  ) / length(old_guard) <> 1
    or position(new_guard in function_definition) > 0
    or position('p_actor_admin_id' in function_definition) = 0
    or position('p_question_count not between 1 and 500' in function_definition) = 0
    or not security_definer_before
    or not exists (
      select 1
      from unnest(coalesce(config_before, array[]::text[])) as setting(value)
      where setting.value in ('search_path=', 'search_path=""')
    )
  then
    raise exception 'sparse_question_bank_system_writer_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    old_guard,
    new_guard
  );

  if position(old_guard in function_definition) > 0
    or position(new_guard in function_definition) = 0
    or position('units_must_be_contiguous' in function_definition) > 0
  then
    raise exception 'sparse_question_bank_system_writer_rewrite_failed';
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
    raise exception 'sparse_question_bank_system_writer_metadata_changed';
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

revoke all on function private.create_assignment_with_question_bank_system_v1(
  uuid,
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

notify pgrst, 'reload schema';

commit;
