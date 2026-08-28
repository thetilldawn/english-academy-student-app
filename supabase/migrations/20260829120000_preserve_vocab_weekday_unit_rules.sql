begin;

-- R2-3 keeps the original weekday allocation rule beside the already
-- materialized queue items. Legacy v2 rows remain readable with null values.
alter table private.vocab_assignment_queue_requests
  add column resolved_plan_sha256 text;

alter table private.vocab_assignment_queue_requests
  add constraint vocab_assignment_queue_requests_plan_sha_check
  check (
    resolved_plan_sha256 is null
    or resolved_plan_sha256 ~ '^[0-9a-f]{64}$'
  );

alter table private.vocab_assignment_series
  add column split_basis text,
  add column allocation_rule jsonb,
  add column allocation_rule_sha256 text;

alter table private.vocab_assignment_series
  add constraint vocab_assignment_series_split_basis_check
  check (
    split_basis is null
    or split_basis in ('question_count', 'range_unit')
  ),
  add constraint vocab_assignment_series_allocation_rule_check
  check (
    (
      split_basis is null
      and allocation_rule is null
      and allocation_rule_sha256 is null
    )
    or (
      split_basis = 'question_count'
      and allocation_rule is null
      and allocation_rule_sha256 is null
    )
    or (
      split_basis = 'range_unit'
      and allocation_rule is not null
      and jsonb_typeof(allocation_rule) = 'object'
      and allocation_rule_sha256 is not null
      and allocation_rule_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

create function private.create_vocab_assignment_queues_v2(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_series jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
  plan_sha256_value text;
  series_input jsonb;
  rule_value jsonb;
  updated_series_count integer := 0;
begin
  if p_series is null
    or jsonb_typeof(p_series) <> 'array'
    or jsonb_array_length(p_series) not between 1 and 210
  then
    raise exception 'invalid_vocab_assignment_queue_rule'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    where jsonb_typeof(series.value) <> 'object'
      or coalesce(series.value ->> 'split_basis', '')
        not in ('question_count', 'range_unit')
      or coalesce(series.value ->> 'resolved_plan_sha256', '')
        !~ '^[0-9a-f]{64}$'
      or (
        series.value ->> 'split_basis' = 'question_count'
        and coalesce(series.value -> 'allocation_rule', 'null'::jsonb)
          <> 'null'::jsonb
      )
      or (
        series.value ->> 'split_basis' = 'range_unit'
        and jsonb_typeof(series.value -> 'allocation_rule')
          is distinct from 'object'
      )
  ) then
    raise exception 'invalid_vocab_assignment_queue_rule_shape'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    cross join lateral (
      select series.value -> 'allocation_rule' as rule
    ) as input
    where series.value ->> 'split_basis' = 'range_unit'
      and (
        (input.rule - array[
          'schema_version',
          'mode',
          'units_per_session',
          'weekday_units_per_session',
          'base_session_unit_counts',
          'ordered_unit_ids',
          'overflow_policy',
          'extra_date_policy'
        ]) <> '{}'::jsonb
        or jsonb_typeof(input.rule -> 'schema_version')
          is distinct from 'number'
        or input.rule ->> 'schema_version' is distinct from '1'
        or coalesce(input.rule ->> 'mode', '')
          not in ('same', 'by_weekday')
        or jsonb_typeof(input.rule -> 'units_per_session')
          is distinct from 'number'
        or coalesce(case
          when coalesce(input.rule ->> 'units_per_session', '')
            ~ '^[0-9]{1,2}$'
          then (input.rule ->> 'units_per_session')::integer
          else null
        end, 0) not between 1 and 30
        or jsonb_typeof(input.rule -> 'weekday_units_per_session')
          is distinct from 'array'
        or jsonb_array_length(input.rule -> 'weekday_units_per_session') <> 7
        or jsonb_typeof(input.rule -> 'base_session_unit_counts')
          is distinct from 'array'
        or jsonb_array_length(input.rule -> 'base_session_unit_counts') < 1
        or jsonb_array_length(input.rule -> 'base_session_unit_counts') > 7
        or jsonb_typeof(input.rule -> 'ordered_unit_ids')
          is distinct from 'array'
        or jsonb_array_length(input.rule -> 'ordered_unit_ids') not between 1 and 500
        or coalesce(input.rule ->> 'overflow_policy', '')
          not in ('leave', 'continue_weekly')
        or coalesce(input.rule ->> 'extra_date_policy', '')
          not in ('unconfirmed', 'repeat_from_start')
        or jsonb_array_length(input.rule -> 'base_session_unit_counts') <>
          jsonb_array_length(series.value -> 'recurrence_slots')
      )
  ) then
    raise exception 'invalid_vocab_assignment_queue_rule_value'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    cross join lateral jsonb_array_elements(
      series.value -> 'allocation_rule' -> 'weekday_units_per_session'
    ) as weekday(value)
    where series.value ->> 'split_basis' = 'range_unit'
      and (
        jsonb_typeof(weekday.value) <> 'object'
        or (weekday.value - array['isodow', 'unit_count']) <> '{}'::jsonb
        or jsonb_typeof(weekday.value -> 'isodow')
          is distinct from 'number'
        or coalesce(case
          when coalesce(weekday.value ->> 'isodow', '') ~ '^[1-7]$'
          then (weekday.value ->> 'isodow')::integer
          else null
        end, 0) not between 1 and 7
        or jsonb_typeof(weekday.value -> 'unit_count')
          is distinct from 'number'
        or coalesce(case
          when coalesce(weekday.value ->> 'unit_count', '') ~ '^[0-9]{1,2}$'
          then (weekday.value ->> 'unit_count')::integer
          else null
        end, 0) not between 1 and 30
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    cross join lateral jsonb_array_elements(
      series.value -> 'allocation_rule' -> 'weekday_units_per_session'
    ) as weekday(value)
    where series.value ->> 'split_basis' = 'range_unit'
    group by series.value
    having count(distinct weekday.value ->> 'isodow') <> 7
  ) then
    raise exception 'invalid_vocab_assignment_queue_weekday_counts'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    cross join lateral jsonb_array_elements(
      series.value -> 'allocation_rule' -> 'base_session_unit_counts'
    ) with ordinality as base(value, position)
    join lateral jsonb_array_elements(series.value -> 'recurrence_slots')
      with ordinality as slot(value, position)
      on slot.position = base.position
    where series.value ->> 'split_basis' = 'range_unit'
      and (
        jsonb_typeof(base.value) <> 'number'
        or coalesce(case
          when trim(both '"' from base.value::text) ~ '^[0-9]{1,2}$'
          then trim(both '"' from base.value::text)::integer
          else null
        end, 0) not between 1 and 30
        or coalesce(case
          when trim(both '"' from base.value::text) ~ '^[0-9]{1,2}$'
          then trim(both '"' from base.value::text)::integer
          else null
        end, 0) <> case
          when series.value -> 'allocation_rule' ->> 'mode' = 'same'
          then (series.value -> 'allocation_rule' ->> 'units_per_session')::integer
          else (
            select (weekday.value ->> 'unit_count')::integer
            from jsonb_array_elements(
              series.value -> 'allocation_rule' -> 'weekday_units_per_session'
            ) as weekday(value)
            where (weekday.value ->> 'isodow')::integer =
              (slot.value ->> 'isodow')::integer
          )
        end
      )
  ) then
    raise exception 'vocab_assignment_queue_rule_recurrence_mismatch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    cross join lateral jsonb_array_elements_text(
      series.value -> 'allocation_rule' -> 'ordered_unit_ids'
    ) as unit(value)
    where series.value ->> 'split_basis' = 'range_unit'
      and unit.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'invalid_vocab_assignment_queue_rule_unit'
      using errcode = '22023';
  end if;

  select min(series.value ->> 'resolved_plan_sha256')
  into plan_sha256_value
  from jsonb_array_elements(p_series) as series(value);

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    where series.value ->> 'resolved_plan_sha256' <> plan_sha256_value
  ) then
    raise exception 'vocab_assignment_queue_plan_mismatch'
      using errcode = '22023';
  end if;

  result_value := private.create_vocab_assignment_queues_v1(
    p_idempotency_key,
    p_request_sha256,
    p_series
  );

  update private.vocab_assignment_queue_requests
  set resolved_plan_sha256 = plan_sha256_value
  where idempotency_key = p_idempotency_key
    and (
      resolved_plan_sha256 is null
      or resolved_plan_sha256 = plan_sha256_value
    );
  if not found then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  for series_input in
    select value
    from jsonb_array_elements(p_series) as input(value)
  loop
    rule_value := nullif(series_input -> 'allocation_rule', 'null'::jsonb);
    update private.vocab_assignment_series
    set split_basis = series_input ->> 'split_basis',
        allocation_rule = rule_value,
        allocation_rule_sha256 = case
          when rule_value is null then null
          else encode(
            extensions.digest(convert_to(rule_value::text, 'UTF8'), 'sha256'),
            'hex'
          )
        end
    where request_id = p_idempotency_key
      and student_id = (series_input ->> 'student_id')::uuid
      and (
        split_basis is null
        or split_basis = series_input ->> 'split_basis'
      )
      and (
        allocation_rule is null
        or allocation_rule = rule_value
      );
    if not found then
      raise exception 'vocab_assignment_queue_rule_persistence_mismatch'
        using errcode = '23505';
    end if;
    updated_series_count := updated_series_count + 1;
  end loop;

  if updated_series_count <> jsonb_array_length(p_series) then
    raise exception 'vocab_assignment_queue_rule_count_mismatch'
      using errcode = '21000';
  end if;

  return result_value;
end;
$$;

create function public.create_vocab_assignment_queues_v3(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_series jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.create_vocab_assignment_queues_v2(
    p_idempotency_key,
    p_request_sha256,
    p_series
  );
end;
$$;

create function public.list_vocab_assignment_unit_rules_v1(
  p_assignment_ids uuid[]
)
returns table (
  assignment_id uuid,
  allocation_rule jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_assignment_ids is null
    or cardinality(p_assignment_ids) not between 1 and 500
    or array_position(p_assignment_ids, null) is not null
  then
    raise exception 'invalid_vocab_assignment_rule_lookup'
      using errcode = '22023';
  end if;
  return query
  select item.assignment_id, series.allocation_rule
  from private.vocab_assignment_series_items as item
  join private.vocab_assignment_series as series on series.id = item.series_id
  where item.assignment_id = any(p_assignment_ids)
    and series.split_basis = 'range_unit'
    and series.allocation_rule is not null
  order by item.assignment_id;
end;
$$;

create function public.list_vocab_assignment_queue_summaries_v2(
  p_include_closed boolean default false,
  p_student_id uuid default null,
  p_before_updated_at timestamptz default null,
  p_before_series_id uuid default null,
  p_limit integer default null
)
returns table (
  series_id uuid,
  student_id uuid,
  status text,
  attention_reason text,
  dataset_label text,
  range_label text,
  total_session_count integer,
  completed_session_count integer,
  remaining_session_count integer,
  total_question_count integer,
  remaining_question_count integer,
  current_assignment_id uuid,
  next_available_from timestamptz,
  next_available_until timestamptz,
  items jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  allocation_rule jsonb,
  recurrence_weekdays integer[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select
    summary.series_id,
    summary.student_id,
    summary.status,
    summary.attention_reason,
    summary.dataset_label,
    summary.range_label,
    summary.total_session_count,
    summary.completed_session_count,
    summary.remaining_session_count,
    summary.total_question_count,
    summary.remaining_question_count,
    summary.current_assignment_id,
    summary.next_available_from,
    summary.next_available_until,
    summary.items,
    summary.created_at,
    summary.updated_at,
    series.allocation_rule,
    case
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
  from public.list_vocab_assignment_queue_summaries_v1(
    p_include_closed,
    p_student_id,
    p_before_updated_at,
    p_before_series_id,
    p_limit
  ) as summary
  join private.vocab_assignment_series as series
    on series.id = summary.series_id
  order by summary.updated_at desc, summary.series_id desc;
end;
$$;

revoke all on function private.create_vocab_assignment_queues_v2(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.create_vocab_assignment_queues_v3(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_vocab_assignment_queues_v3(
  uuid, text, jsonb
) to authenticated, service_role;

revoke all on function public.list_vocab_assignment_unit_rules_v1(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.list_vocab_assignment_unit_rules_v1(uuid[])
  to authenticated, service_role;

revoke all on function public.list_vocab_assignment_queue_summaries_v2(
  boolean, uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_vocab_assignment_queue_summaries_v2(
  boolean, uuid, timestamptz, uuid, integer
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
