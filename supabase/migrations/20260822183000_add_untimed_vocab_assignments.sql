begin;

alter table public.assignments
  drop constraint if exists assignments_timing_mode_check,
  drop constraint if exists assignments_timing_mode_consistent;

alter table public.assignments
  add constraint assignments_timing_mode_check
    check (timing_mode in ('none', 'total', 'per_question')),
  add constraint assignments_timing_mode_consistent check (
    (timing_mode = 'none' and question_time_limit_seconds is null)
    or
    (timing_mode = 'total' and question_time_limit_seconds is null)
    or
    (timing_mode = 'per_question' and question_time_limit_seconds is not null)
  );

alter table public.admin_vocab_assignment_time_templates
  drop constraint if exists admin_vocab_assignment_time_templates_timing_mode_check,
  drop constraint if exists admin_vocab_assignment_time_templates_check;

alter table public.admin_vocab_assignment_time_templates
  add constraint admin_vocab_assignment_time_templates_timing_mode_check
    check (timing_mode in ('none', 'total', 'per_question')),
  add constraint admin_vocab_assignment_time_templates_check check (
    (
      timing_mode = 'none'
      and total_seconds is null
      and per_question_seconds is null
    )
    or
    (
      timing_mode = 'total'
      and total_seconds is not null
      and per_question_seconds is null
    )
    or
    (
      timing_mode = 'per_question'
      and total_seconds is null
      and per_question_seconds is not null
    )
  );

create or replace function private.configure_assignment_delivery_v1(
  p_assignment_id uuid,
  p_timing_mode text,
  p_question_time_limit_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_timing_mode not in ('none', 'total', 'per_question')
    or (
      p_timing_mode in ('none', 'total')
      and p_question_time_limit_seconds is not null
    )
    or (
      p_timing_mode = 'per_question'
      and (
        p_question_time_limit_seconds is null
        or p_question_time_limit_seconds not between 5 and 600
      )
    )
  then
    raise exception 'invalid_timing_settings' using errcode = '22023';
  end if;

  perform 1
  from public.assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.quiz_attempts
    where assignment_id = p_assignment_id
  ) then
    raise exception 'assignment_already_started' using errcode = '22023';
  end if;

  update public.assignments
  set timing_mode = p_timing_mode,
      question_time_limit_seconds = p_question_time_limit_seconds,
      updated_at = now()
  where id = p_assignment_id;
end;
$$;

-- The completion-gated queue writes assignments without an authenticated
-- browser session. Keep its reviewed body and only widen the timing enum.
do $migration$
declare
  function_definition text;
  old_fragment text := 'p_timing_mode not in (''total'', ''per_question'')';
  new_fragment text := 'p_timing_mode not in (''none'', ''total'', ''per_question'')';
  old_consistency_fragment text := 'p_timing_mode = ''total''';
  new_consistency_fragment text := 'p_timing_mode in (''none'', ''total'')';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_delivery_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  ) into function_definition;

  if position(old_fragment in function_definition) = 0 then
    raise exception 'untimed_queue_writer_shape_changed';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);
  if position(old_consistency_fragment in function_definition) = 0 then
    raise exception 'untimed_queue_writer_consistency_shape_changed';
  end if;
  function_definition := replace(
    function_definition,
    old_consistency_fragment,
    new_consistency_fragment
  );
  if position(old_fragment in function_definition) > 0
    or position(old_consistency_fragment in function_definition) > 0
  then
    raise exception 'untimed_queue_writer_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- Assignment replacement has an additional validation guard before it calls
-- the central delivery writer.
do $migration$
declare
  function_definition text;
  old_fragment text := 'p_timing_mode not in (''total'', ''per_question'')';
  new_fragment text := 'p_timing_mode not in (''none'', ''total'', ''per_question'')';
  old_consistency_fragment text := 'p_timing_mode = ''total''';
  new_consistency_fragment text := 'p_timing_mode in (''none'', ''total'')';
begin
  select replace(
    pg_get_functiondef(
      'private.replace_student_assignment_v4(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  ) into function_definition;

  if position(old_fragment in function_definition) = 0 then
    raise exception 'untimed_assignment_replacement_shape_changed';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);
  if position(old_consistency_fragment in function_definition) = 0 then
    raise exception 'untimed_assignment_replacement_consistency_shape_changed';
  end if;
  function_definition := replace(
    function_definition,
    old_consistency_fragment,
    new_consistency_fragment
  );
  if position(old_fragment in function_definition) > 0
    or position(old_consistency_fragment in function_definition) > 0
  then
    raise exception 'untimed_assignment_replacement_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- Both attempt creation paths keep deadline_at NOT NULL. PostgreSQL infinity
-- is ignored by stale-attempt finalizers and never reaches a browser timer.
do $migration$
declare
  function_oid regprocedure;
  function_definition text;
  old_fragment text := 'now() + make_interval(secs => assignment_row.time_limit_seconds),';
  new_fragment text := E'case\n      when assignment_row.timing_mode = ''none''\n        then coalesce(assignment_row.available_until, ''infinity''::timestamptz)\n      else now() + make_interval(secs => assignment_row.time_limit_seconds)\n    end,';
begin
  foreach function_oid in array array[
    'public.create_quiz_attempt(uuid,uuid,jsonb)'::regprocedure,
    'public.create_quiz_attempt_from_bank(uuid,uuid)'::regprocedure
  ] loop
    select replace(pg_get_functiondef(function_oid), chr(13), '')
      into function_definition;
    if position(old_fragment in function_definition) = 0 then
      raise exception 'untimed_attempt_writer_shape_changed: %', function_oid;
    end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);
    if position(old_fragment in function_definition) > 0 then
      raise exception 'untimed_attempt_writer_rewrite_failed: %', function_oid;
    end if;
    execute function_definition;
  end loop;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_fragment text := E'  retry_deadline := retry_start_time\n    + make_interval(secs => attempt_row.time_limit_seconds_snapshot);';
  new_fragment text := E'  retry_deadline := case\n    when exists (\n      select 1\n      from public.assignments as assignment\n      where assignment.id = attempt_row.assignment_id\n        and assignment.timing_mode = ''none''\n    ) then coalesce(\n      (\n        select assignment.available_until\n        from public.assignments as assignment\n        where assignment.id = attempt_row.assignment_id\n      ),\n      ''infinity''::timestamptz\n    )\n    else retry_start_time\n      + make_interval(secs => attempt_row.time_limit_seconds_snapshot)\n  end;';
begin
  select replace(
    pg_get_functiondef('public.start_quiz_retry(uuid,uuid)'::regprocedure),
    chr(13),
    ''
  ) into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'untimed_retry_writer_shape_changed';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);
  if position(old_fragment in function_definition) > 0 then
    raise exception 'untimed_retry_writer_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
