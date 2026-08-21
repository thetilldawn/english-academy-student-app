-- A Korean-to-English prompt is ambiguous only when this assignment contains
-- another Korean-to-English target with the same meaning and a different word.
-- Entries used in the opposite direction must not make the whole range fail.
do $migration$
declare
  target_signature text;
  target_oid oid;
  function_definition text;
  patched_definition text;
  old_guard text := E'            or exists (\n              select 1\n              from public.vocab_entries as other_entry\n              where other_entry.dataset_id = p_dataset_id\n                and other_entry.unit_id = any(p_unit_ids)\n                and other_entry.headword_normalized\n                  <> entry.headword_normalized\n                and lower(trim(other_entry.primary_meaning))\n                  = lower(trim(entry.primary_meaning))\n            )';
  selected_question_guard text := E'            or exists (\n              select 1\n              from public.assignment_questions as other_question\n              join public.vocab_entries as other_entry\n                on other_entry.id = other_question.vocab_entry_id\n              where other_question.assignment_id = created_assignment_id\n                and other_question.id <> question.id\n                and other_question.direction = ''korean_to_english''\n                and other_entry.dataset_id = p_dataset_id\n                and other_entry.headword_normalized\n                  <> entry.headword_normalized\n                and lower(trim(other_entry.primary_meaning))\n                  = lower(trim(entry.primary_meaning))\n            )';
  old_guard_count integer;
  selected_guard_count integer;
  owner_before oid;
  acl_before aclitem[];
  return_type_before oid;
  security_definer_before boolean;
  config_before text[];
  volatility_before "char";
  parallel_before "char";
begin
  foreach target_signature in array array[
    'private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)',
    'private.create_assignment_with_question_bank_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'
  ] loop
    target_oid := to_regprocedure(target_signature);
    if target_oid is null then
      raise exception 'assignment_prompt_scope_target_missing: %',
        target_signature;
    end if;

    select
      replace(pg_get_functiondef(target_oid), chr(13), ''),
      procedure.proowner,
      procedure.proacl,
      procedure.prorettype,
      procedure.prosecdef,
      procedure.proconfig,
      procedure.provolatile,
      procedure.proparallel
    into
      function_definition,
      owner_before,
      acl_before,
      return_type_before,
      security_definer_before,
      config_before,
      volatility_before,
      parallel_before
    from pg_proc as procedure
    where procedure.oid = target_oid;

    old_guard_count := (
      length(function_definition)
        - length(replace(function_definition, old_guard, ''))
    ) / length(old_guard);
    selected_guard_count := (
      length(function_definition)
        - length(replace(function_definition, selected_question_guard, ''))
    ) / length(selected_question_guard);

    if old_guard_count <> 1 or selected_guard_count <> 0 then
      raise exception 'assignment_prompt_scope_shape_changed: %',
        target_signature;
    end if;

    patched_definition := replace(
      function_definition,
      old_guard,
      selected_question_guard
    );

    if position(old_guard in patched_definition) > 0
      or (
        length(patched_definition)
          - length(replace(
            patched_definition,
            selected_question_guard,
            ''
          ))
      ) / length(selected_question_guard) <> 1
    then
      raise exception 'assignment_prompt_scope_rewrite_failed: %',
        target_signature;
    end if;

    execute patched_definition;

    if exists (
      select 1
      from pg_proc as procedure
      where procedure.oid = target_oid
        and (
          procedure.proowner <> owner_before
          or procedure.proacl is distinct from acl_before
          or procedure.prorettype <> return_type_before
          or procedure.prosecdef <> security_definer_before
          or procedure.proconfig is distinct from config_before
          or procedure.provolatile <> volatility_before
          or procedure.proparallel <> parallel_before
        )
    ) then
      raise exception 'assignment_prompt_scope_metadata_changed: %',
        target_signature;
    end if;
  end loop;
end;
$migration$;

