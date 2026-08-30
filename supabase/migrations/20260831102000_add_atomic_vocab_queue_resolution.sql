begin;

create function private.get_vocab_assignment_queue_summary_v1(
  p_series_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_series_id is null then
    raise exception 'invalid_vocab_queue_summary_request'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'series_id', series.id,
    'student_id', series.student_id,
    'status', series.status,
    'attention_reason', series.attention_reason,
    'dataset_label', series.dataset_label,
    'range_label', series.range_label,
    'total_session_count', count(item.id)::integer,
    'completed_session_count', count(item.id) filter (
      where item.status = 'completed'
    )::integer,
    'remaining_session_count', count(item.id) filter (
      where item.status not in ('completed', 'cancelled')
    )::integer,
    'total_question_count', coalesce(sum(item.question_count), 0)::integer,
    'remaining_question_count', coalesce(sum(item.question_count) filter (
      where item.status not in ('completed', 'cancelled')
    ), 0)::integer,
    'current_assignment_id', (array_agg(
      item.assignment_id order by item.sequence_number
    ) filter (where item.status = 'assigned'))[1],
    'next_available_from', (array_agg(
      item.effective_available_from order by item.sequence_number
    ) filter (where item.status not in ('completed', 'cancelled')))[1],
    'next_available_until', (array_agg(
      item.effective_available_until order by item.sequence_number
    ) filter (where item.status not in ('completed', 'cancelled')))[1],
    'items', jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'sequenceNumber', item.sequence_number,
        'status', item.status,
        'questionCount', item.question_count,
        'unitLabels', to_jsonb(item.unit_labels),
        'plannedAvailableFrom', item.planned_available_from,
        'plannedAvailableUntil', item.planned_available_until,
        'effectiveAvailableFrom', item.effective_available_from,
        'effectiveAvailableUntil', item.effective_available_until,
        'assignmentId', item.assignment_id,
        'attentionReason', item.attention_reason,
        'materializedAt', item.materialized_at,
        'completedAt', item.completed_at
      ) order by item.sequence_number
    ),
    'created_at', series.created_at,
    'updated_at', series.updated_at,
    'allocation_rule', series.allocation_rule,
    'recurrence_weekdays', case
      when series.split_basis = 'range_unit'
        and series.allocation_rule is not null
      then array(
        select distinct (slot.value ->> 'isodow')::integer
        from jsonb_array_elements(series.recurrence_slots) as slot(value)
        where coalesce(slot.value ->> 'isodow', '') ~ '^[1-7]$'
        order by (slot.value ->> 'isodow')::integer
      )
      else array[]::integer[]
    end
  )
  into result
  from private.vocab_assignment_series as series
  join private.vocab_assignment_series_items as item
    on item.series_id = series.id
  where series.id = p_series_id
  group by series.id;

  return result;
end;
$$;

create function private.resolve_vocab_assignment_queue_attention_v2(
  p_series_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolution jsonb;
  student_id_value uuid;
  ready_item_id uuid;
  materialized jsonb;
  queue_summary jsonb;
  evaluation_at timestamptz;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_series_id is null
    or p_action is null
    or p_action not in ('retry', 'skip', 'cancel')
  then
    raise exception 'invalid_vocab_queue_resolution'
      using errcode = '22023';
  end if;

  select series.student_id
  into student_id_value
  from private.vocab_assignment_series as series
  where series.id = p_series_id;
  if not found then
    raise exception 'vocab_queue_attention_not_found'
      using errcode = 'P0002';
  end if;

  -- Match the student -> series -> item lock order used by student deletion.
  perform 1
  from public.students as student
  where student.id = student_id_value
  for update;
  if not found then
    raise exception 'vocab_queue_student_not_found'
      using errcode = 'P0002';
  end if;

  resolution := private.resolve_vocab_assignment_queue_attention_v1(
    p_series_id,
    p_action
  );

  if p_action in ('retry', 'skip') then
    select item.id
    into ready_item_id
    from private.vocab_assignment_series_items as item
    where item.series_id = p_series_id
      and item.status = 'ready'
    order by item.sequence_number, item.id
    limit 1
    for update;

    if ready_item_id is not null then
      evaluation_at := clock_timestamp();
      materialized := private.materialize_ready_vocab_assignment_queue_v2(
        (resolution ->> 'student_id')::uuid,
        1,
        evaluation_at,
        ready_item_id
      );
      if jsonb_array_length(materialized) <> 1
        or materialized -> 0 ->> 'series_id' <> p_series_id::text
        or materialized -> 0 ->> 'item_id' <> ready_item_id::text
        or materialized -> 0 ->> 'status' <> 'assigned'
      then
        raise exception 'vocab_queue_materialization_failed'
          using errcode = '55000';
      end if;
    elsif p_action = 'retry' then
      raise exception 'vocab_queue_retry_item_missing'
        using errcode = '55000';
    end if;
  end if;

  queue_summary := private.get_vocab_assignment_queue_summary_v1(p_series_id);
  if queue_summary is null then
    raise exception 'vocab_queue_summary_missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'resolution', resolution,
    'queue', queue_summary
  );
end;
$$;

create function public.resolve_vocab_assignment_queue_attention_v2(
  p_series_id uuid,
  p_action text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.resolve_vocab_assignment_queue_attention_v2(
    p_series_id,
    p_action
  );
$$;

revoke all on function private.get_vocab_assignment_queue_summary_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_vocab_assignment_queue_attention_v2(
  uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.resolve_vocab_assignment_queue_attention_v2(
  uuid, text
) from public, anon, service_role;
grant execute on function public.resolve_vocab_assignment_queue_attention_v2(
  uuid, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
