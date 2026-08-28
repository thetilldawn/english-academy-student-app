begin;

-- A completed idempotent request must replay even after its deadline. New
-- requests validate the deadline immediately before and after the shared exact
-- review writer so database time remains the final authority.
do $rewrite$
declare
  target_function regprocedure :=
    'public.create_current_wrong_review_assignment_v1(uuid,uuid,smallint[],uuid[],uuid,text,text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)'::regprocedure;
  function_definition text;
  pre_write_anchor constant text := E'  if request_row.assignment_id is not null then\n    return request_row.assignment_id;\n  end if;\n\n  perform student.id';
  pre_write_replacement constant text := E'  if request_row.assignment_id is not null then\n    return request_row.assignment_id;\n  end if;\n\n  if p_available_until is not null\n    and p_available_until <= clock_timestamp()\n  then\n    raise exception ''assignment_deadline_must_be_future''\n      using errcode = ''22023'';\n  end if;\n\n  perform student.id';
  post_write_anchor constant text := E'  perform private.configure_assignment_retry_v1(\n    created_assignment_id,\n    p_retry_enabled,\n    p_retry_passing_score\n  );\n\n  update private.current_wrong_review_assignment_requests';
  post_write_replacement constant text := E'  perform private.configure_assignment_retry_v1(\n    created_assignment_id,\n    p_retry_enabled,\n    p_retry_passing_score\n  );\n\n  if p_available_until is not null\n    and p_available_until <= clock_timestamp()\n  then\n    raise exception ''assignment_deadline_elapsed_during_review_creation''\n      using errcode = ''22023'';\n  end if;\n\n  update private.current_wrong_review_assignment_requests';
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
    - length(replace(function_definition, pre_write_anchor, ''))
  ) / length(pre_write_anchor) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, post_write_anchor, ''))
    ) / length(post_write_anchor) <> 1
    or position('assignment_deadline_must_be_future' in function_definition) > 0
    or position(
      'assignment_deadline_elapsed_during_review_creation'
      in function_definition
    ) > 0
    or not security_definer_before
  then
    raise exception 'current_wrong_review_deadline_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    pre_write_anchor,
    pre_write_replacement
  );
  function_definition := replace(
    function_definition,
    post_write_anchor,
    post_write_replacement
  );
  execute function_definition;

  if not exists (
    select 1
    from pg_proc
    where oid = target_function::oid
      and proowner = owner_before
      and proacl is not distinct from acl_before
      and prosecdef = security_definer_before
      and proconfig is not distinct from config_before
  ) then
    raise exception 'current_wrong_review_deadline_metadata_changed';
  end if;
end;
$rewrite$;

notify pgrst, 'reload schema';

commit;
