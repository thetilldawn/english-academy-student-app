begin;

-- Keep the teacher's explicit DAY direction as part of the assignment range.
-- Empty primary ranges are valid only for review-only assignments.
create function private.resolve_contiguous_unit_direction_v1(
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
  if minimum_step = 1 and maximum_step = 1 then
    return 1;
  end if;
  if minimum_step = -1 and maximum_step = -1 then
    return -1;
  end if;

  raise exception 'assignment_unit_range_not_contiguous'
    using errcode = '22023';
end;
$$;

create function private.align_assignment_unit_direction_v1(
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
  descending_primary_unit_ids uuid[];
begin
  if p_assignment_id is null then
    raise exception 'assignment_unit_order_missing_assignment'
      using errcode = '22023';
  end if;

  requested_direction := private.resolve_contiguous_unit_direction_v1(
    p_dataset_id,
    p_primary_unit_ids
  );

  select coalesce(
    array_agg(link.unit_id order by link.position)
      filter (where link.is_primary),
    array[]::uuid[]
  )
  into current_primary_unit_ids
  from public.assignment_units as link
  where link.assignment_id = p_assignment_id;

  if current_primary_unit_ids is not distinct from p_primary_unit_ids then
    return;
  end if;
  if requested_direction <> -1 then
    raise exception 'assignment_primary_unit_order_mismatch'
      using errcode = '22023';
  end if;

  select coalesce(
    array_agg(link.unit_id order by unit.sort_index desc, unit.id)
      filter (where link.is_primary),
    array[]::uuid[]
  )
  into descending_primary_unit_ids
  from public.assignment_units as link
  join public.vocab_units as unit
    on unit.id = link.unit_id
   and unit.dataset_id = p_dataset_id
  where link.assignment_id = p_assignment_id;

  if descending_primary_unit_ids is distinct from p_primary_unit_ids then
    raise exception 'assignment_primary_unit_set_mismatch'
      using errcode = '22023';
  end if;

  -- assignment_units has a unique (assignment_id, position) constraint.
  -- Move every position out of the target range before assigning 1..N.
  update public.assignment_units
  set position = position + 1000000
  where assignment_id = p_assignment_id;

  with ranked_units as (
    select
      link.unit_id,
      row_number() over (
        order by unit.sort_index desc, unit.id
      )::integer as next_position
    from public.assignment_units as link
    join public.vocab_units as unit
      on unit.id = link.unit_id
     and unit.dataset_id = p_dataset_id
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
end;
$$;

create function private.create_mixed_review_assignment_v9(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_review_scope text,
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.resolve_contiguous_unit_direction_v1(
    p_dataset_id,
    p_primary_unit_ids
  );
  created_assignment_id := private.create_mixed_review_assignment_v8(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_review_scope,
    p_selected_queue_ids,
    p_title,
    p_primary_unit_ids,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
  perform private.align_assignment_unit_direction_v1(
    created_assignment_id,
    p_dataset_id,
    p_primary_unit_ids
  );
  return created_assignment_id;
end;
$$;

create function public.create_mixed_review_assignment_v9(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_review_scope text,
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_mixed_review_assignment_v9(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_review_scope,
    p_selected_queue_ids,
    p_title,
    p_primary_unit_ids,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
$$;

create function private.create_bulk_vocab_assignments_v4(p_batches jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row record;
  result_value jsonb;
  batch_unit_ids uuid[];
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_batches is null or jsonb_typeof(p_batches) <> 'array' then
    raise exception 'invalid_bulk_assignment_batch'
      using errcode = '22023';
  end if;

  for batch_row in
    select input.value as batch
    from jsonb_array_elements(p_batches) as input(value)
  loop
    if jsonb_typeof(batch_row.batch -> 'unit_ids') <> 'array' then
      raise exception 'invalid_bulk_assignment_unit_range'
        using errcode = '22023';
    end if;
    select coalesce(
      array_agg(value::uuid order by position),
      array[]::uuid[]
    )
    into batch_unit_ids
    from jsonb_array_elements_text(batch_row.batch -> 'unit_ids')
      with ordinality as unit(value, position);
    if cardinality(batch_unit_ids) < 1 then
      raise exception 'invalid_bulk_assignment_unit_range'
        using errcode = '22023';
    end if;
    perform private.resolve_contiguous_unit_direction_v1(
      (batch_row.batch ->> 'dataset_id')::uuid,
      batch_unit_ids
    );
  end loop;

  result_value := private.create_bulk_vocab_assignments_v3(p_batches);
  if jsonb_typeof(result_value) <> 'array'
    or jsonb_array_length(result_value) <> jsonb_array_length(p_batches)
  then
    raise exception 'bulk_assignment_result_mismatch'
      using errcode = '21000';
  end if;

  for batch_row in
    select
      input.value as batch,
      output.value as result
    from jsonb_array_elements(p_batches) with ordinality
      as input(value, position)
    join jsonb_array_elements(result_value) with ordinality
      as output(value, position)
      using (position)
  loop
    select array_agg(value::uuid order by position)
    into batch_unit_ids
    from jsonb_array_elements_text(batch_row.batch -> 'unit_ids')
      with ordinality as unit(value, position);
    perform private.align_assignment_unit_direction_v1(
      (batch_row.result ->> 'assignment_id')::uuid,
      (batch_row.batch ->> 'dataset_id')::uuid,
      batch_unit_ids
    );
  end loop;

  return result_value;
end;
$$;

create function public.create_bulk_vocab_assignments_v4(p_batches jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_bulk_vocab_assignments_v4(p_batches);
$$;

-- Keep the mature replacement transaction and inject direction alignment
-- before v3 reads the persisted primary-unit order for its result and audit.
do $migration$
declare
  function_definition text;
  insertion_marker text := E'  select assignment.assignment_purpose\n  into replacement_purpose';
begin
  select replace(
    pg_get_functiondef(
      'private.replace_student_assignment_v3(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(
    'private.replace_student_assignment_v3('
    in function_definition
  ) = 0
    or position(insertion_marker in function_definition) = 0
    or position(
      'private.align_assignment_unit_direction_v1('
      in function_definition
    ) > 0
  then
    raise exception 'replace_student_assignment_v3_direction_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.replace_student_assignment_v3(',
    'private.replace_student_assignment_v4('
  );
  function_definition := replace(
    function_definition,
    insertion_marker,
    E'  perform private.align_assignment_unit_direction_v1(\n    created_replacement_assignment_id,\n    p_dataset_id,\n    p_primary_unit_ids\n  );\n\n' || insertion_marker
  );

  if position(
    'private.replace_student_assignment_v3('
    in function_definition
  ) > 0
    or position(
      'private.align_assignment_unit_direction_v1('
      in function_definition
    ) = 0
  then
    raise exception 'replace_student_assignment_v4_direction_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

create function public.replace_student_assignment_v4(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
  p_review_snapshot_mode text,
  p_title text,
  p_dataset_id uuid,
  p_primary_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.replace_student_assignment_v4(
    p_source_assignment_id,
    p_student_id,
    p_idempotency_key,
    p_request_sha256,
    p_replacement_kind,
    p_review_snapshot_mode,
    p_title,
    p_dataset_id,
    p_primary_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_review_levels,
    p_selected_queue_ids,
    p_questions
  );
$$;

revoke all on function private.resolve_contiguous_unit_direction_v1(
  uuid, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function private.align_assignment_unit_direction_v1(
  uuid, uuid, uuid[]
) from public, anon, authenticated, service_role;

revoke all on function private.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

revoke all on function private.create_bulk_vocab_assignments_v4(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.create_bulk_vocab_assignments_v4(jsonb)
  to authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v4(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v4(jsonb)
  to authenticated, service_role;

revoke all on function private.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) to authenticated, service_role;
revoke all on function public.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
