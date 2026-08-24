begin;

-- A teacher may select separate units from one dataset. Keep the explicit
-- source direction, while continuing to reject duplicates, foreign units,
-- and an order that changes direction midway.
create or replace function private.resolve_contiguous_unit_direction_v1(
  p_dataset_id uuid,
  p_unit_ids uuid[]
)
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matched_unit_count integer;
  minimum_step integer;
  maximum_step integer;
begin
  if p_dataset_id is null or p_unit_ids is null then
    raise exception 'invalid_assignment_unit_range'
      using errcode = '22023';
  end if;
  if cardinality(p_unit_ids) = 0 then
    return 1;
  end if;
  if cardinality(p_unit_ids) <> (
    select count(distinct input.unit_id)
    from unnest(p_unit_ids) as input(unit_id)
    where input.unit_id is not null
  ) then
    raise exception 'invalid_assignment_unit_range'
      using errcode = '22023';
  end if;

  with ordered_units as (
    select
      input.position,
      unit.id as unit_id,
      unit.sort_index,
      lag(unit.sort_index) over (order by input.position)
        as previous_sort_index
    from unnest(p_unit_ids) with ordinality
      as input(unit_id, position)
    left join public.vocab_units as unit
      on unit.id = input.unit_id
     and unit.dataset_id = p_dataset_id
  )
  select
    count(ordered.unit_id),
    min(ordered.sort_index - ordered.previous_sort_index)
      filter (where ordered.previous_sort_index is not null),
    max(ordered.sort_index - ordered.previous_sort_index)
      filter (where ordered.previous_sort_index is not null)
  into matched_unit_count, minimum_step, maximum_step
  from ordered_units as ordered;

  if matched_unit_count <> cardinality(p_unit_ids) then
    raise exception 'assignment_unit_not_in_dataset'
      using errcode = '22023';
  end if;
  if cardinality(p_unit_ids) = 1 then
    return 1;
  end if;
  if minimum_step > 0 and maximum_step > 0 then
    return 1;
  end if;
  if minimum_step < 0 and maximum_step < 0 then
    return -1;
  end if;

  raise exception 'assignment_unit_range_not_monotonic'
    using errcode = '22023';
end;
$$;

-- Legacy question-bank writers may initially attach every unit between the
-- first and last selected unit. Reconcile those links to the teacher's exact
-- ordered selection while preserving any non-primary review-support units.
create or replace function private.align_assignment_unit_direction_v1(
  p_assignment_id uuid,
  p_dataset_id uuid,
  p_primary_unit_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_direction smallint;
  current_primary_unit_ids uuid[];
  requested_link_count integer;
begin
  if p_assignment_id is null then
    raise exception 'assignment_unit_order_missing_assignment'
      using errcode = '22023';
  end if;

  requested_direction := private.resolve_contiguous_unit_direction_v1(
    p_dataset_id,
    p_primary_unit_ids
  );

  select count(*)
  into requested_link_count
  from public.assignment_units as link
  where link.assignment_id = p_assignment_id
    and link.unit_id = any(p_primary_unit_ids);
  if requested_link_count <> cardinality(p_primary_unit_ids) then
    raise exception 'assignment_primary_unit_set_mismatch'
      using errcode = '22023';
  end if;

  delete from public.assignment_units as link
  where link.assignment_id = p_assignment_id
    and link.is_primary
    and not (link.unit_id = any(p_primary_unit_ids));

  -- assignment_units has a unique (assignment_id, position) constraint.
  update public.assignment_units
  set position = position + 1000000,
      is_primary = unit_id = any(p_primary_unit_ids)
  where assignment_id = p_assignment_id;

  with ranked_units as (
    select
      link.unit_id,
      row_number() over (
        order by
          case when link.unit_id = any(p_primary_unit_ids) then 0 else 1 end,
          array_position(p_primary_unit_ids, link.unit_id) nulls last,
          link.position,
          link.unit_id
      )::integer as next_position
    from public.assignment_units as link
    where link.assignment_id = p_assignment_id
  )
  update public.assignment_units as link
  set position = ranked.next_position
  from ranked_units as ranked
  where link.assignment_id = p_assignment_id
    and link.unit_id = ranked.unit_id;

  select coalesce(
    array_agg(link.unit_id order by link.position)
      filter (where link.is_primary),
    array[]::uuid[]
  )
  into current_primary_unit_ids
  from public.assignment_units as link
  where link.assignment_id = p_assignment_id;

  if current_primary_unit_ids is distinct from p_primary_unit_ids then
    raise exception 'assignment_primary_unit_order_mismatch'
      using errcode = '21000';
  end if;

  -- Keep the direction evaluation explicit so reverse selections remain part
  -- of this function's contract even though array_position drives ordering.
  if requested_direction not in (-1, 1) then
    raise exception 'assignment_unit_direction_invalid'
      using errcode = '21000';
  end if;
end;
$$;

-- The public workload guard remains in place, but schedule overlap is no
-- longer a save blocker. The atomic v7 writer already authenticates, locks
-- students, validates the request, and preserves idempotency.
do $migration$
declare
  function_definition text;
  old_delegate text := 'return private.create_bulk_vocab_assignments_v8(';
  new_delegate text := 'return private.create_bulk_vocab_assignments_v7(';
begin
  select replace(
    pg_get_functiondef(
      'public.create_bulk_vocab_assignments_v8(uuid,text,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(old_delegate in function_definition) = 0
    or position('bulk_question_count_exceeded' in function_definition) = 0
  then
    raise exception 'bulk_vocab_public_v8_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    old_delegate,
    new_delegate
  );
  if position(old_delegate in function_definition) > 0
    or position(new_delegate in function_definition) = 0
  then
    raise exception 'bulk_vocab_overlap_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- Queue creation writes its first assignment through a private bulk writer,
-- so apply the same no-conflict policy to that race-sensitive path.
do $migration$
declare
  function_definition text;
  old_delegate text :=
    'first_result := private.create_bulk_vocab_assignments_v8(';
  new_delegate text :=
    'first_result := private.create_bulk_vocab_assignments_v7(';
  old_series_limit text :=
    'jsonb_array_length(p_series) not between 1 and 30';
  new_series_limit text :=
    'jsonb_array_length(p_series) not between 1 and 210';
begin
  select replace(
    pg_get_functiondef(
      'private.create_vocab_assignment_queues_v1(uuid,text,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(old_delegate in function_definition) = 0
    or position(old_series_limit in function_definition) = 0
    or position('vocab_assignment_queue_first_result_mismatch' in function_definition) = 0
  then
    raise exception 'vocab_queue_creator_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    old_delegate,
    new_delegate
  );
  function_definition := replace(
    function_definition,
    old_series_limit,
    new_series_limit
  );
  if position(old_delegate in function_definition) > 0
    or position(new_delegate in function_definition) = 0
    or position(old_series_limit in function_definition) > 0
    or position(new_series_limit in function_definition) = 0
  then
    raise exception 'vocab_queue_creator_overlap_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- The queue delivery helper has a second guard that rejects words already
-- present in another active assignment. Repeating the same selected range is
-- an explicit assignment mode, so the follow-up queue must not fail here.
do $migration$
declare
  function_definition text;
  word_guard text := E'  perform private.assert_assignment_words_available_v2(\n    p_student_ids,\n    p_dataset_id,\n    p_questions\n  );\n';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_delivery_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(word_guard in function_definition) = 0
    or position(
      'private.create_assignment_with_question_bank_dispatch_system_v1('
      in function_definition
    ) = 0
  then
    raise exception 'vocab_queue_delivery_shape_changed';
  end if;

  function_definition := replace(function_definition, word_guard, '');
  if position(word_guard in function_definition) > 0
    or position('private.assert_assignment_words_available_v2(' in function_definition) > 0
  then
    raise exception 'vocab_queue_word_overlap_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- A queued follow-up follows the same overlap rule as its first assignment.
-- Preserve every other materializer guard and swap only the conflict branch.
do $migration$
declare
  function_definition text;
  old_guard text := 'if failure_reason is null and exists (';
  new_guard text := 'if false and failure_reason is null and exists (';
  old_diagnostics text :=
    'get stacked diagnostics failure_code = returned_sqlstate;';
  new_diagnostics text :=
    'get stacked diagnostics failure_code = returned_sqlstate, failure_message = message_text;';
begin
  select replace(
    pg_get_functiondef(
      'private.materialize_ready_vocab_assignment_queue_v1(uuid,integer)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(old_guard in function_definition) = 0
    or position('failure_reason := ''schedule_conflict'';' in function_definition) = 0
    or position(
      'private.align_assignment_unit_direction_v1('
      in function_definition
    ) = 0
  then
    raise exception 'vocab_queue_materializer_shape_changed';
  end if;

  function_definition := replace(function_definition, old_guard, new_guard);
  function_definition := replace(
    function_definition,
    '  failure_code text;',
    E'  failure_code text;\n  failure_message text;'
  );
  function_definition := replace(
    function_definition,
    old_diagnostics,
    new_diagnostics
  );
  function_definition := replace(
    function_definition,
    '''sqlstate'', failure_code',
    '''sqlstate'', failure_code, ''message'', failure_message'
  );
  if position(old_guard in function_definition) > 0
    or position(new_guard in function_definition) = 0
    or position('failure_message text;' in function_definition) = 0
    or position(new_diagnostics in function_definition) = 0
  then
    raise exception 'vocab_queue_overlap_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

revoke all on function private.resolve_contiguous_unit_direction_v1(
  uuid, uuid[]
) from public, anon, authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
