begin;

-- Split vocabulary assignment queues are a durable business workflow, not a
-- transient message queue. Keep the authoritative plan and its audit trail in
-- private relational tables; only narrow RPC projections are exposed.
create table private.vocab_assignment_queue_requests (
  idempotency_key uuid primary key,
  request_sha256 text not null
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text not null
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_admin_id uuid not null references auth.users(id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint vocab_assignment_queue_requests_result_check check (
    (result is null and completed_at is null)
    or (jsonb_typeof(result) = 'array' and completed_at is not null)
  )
);

create table private.vocab_assignment_series (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null
    references private.vocab_assignment_queue_requests(idempotency_key)
    on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  exam_use_release_id uuid
    references word_index.app_exam_use_release(release_id) on delete restrict,
  actor_admin_id uuid not null references auth.users(id) on delete restrict,
  dataset_label text not null
    check (char_length(trim(dataset_label)) between 1 and 160),
  range_label text not null
    check (char_length(trim(range_label)) between 1 and 500),
  recurrence_slots jsonb not null
    check (
      jsonb_typeof(recurrence_slots) = 'array'
      and jsonb_array_length(recurrence_slots) between 1 and 7
    ),
  status text not null default 'active'
    check (status in ('active', 'attention', 'completed', 'cancelled')),
  attention_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint vocab_assignment_series_request_student_unique
    unique (request_id, student_id),
  constraint vocab_assignment_series_terminal_state_check check (
    (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (
      status in ('active', 'attention')
      and completed_at is null
      and cancelled_at is null
    )
  )
);

create table private.vocab_assignment_series_items (
  id uuid primary key default extensions.gen_random_uuid(),
  series_id uuid not null
    references private.vocab_assignment_series(id) on delete restrict,
  sequence_number integer not null check (sequence_number between 1 and 210),
  status text not null default 'queued'
    check (
      status in (
        'queued', 'ready', 'assigned', 'completed', 'attention', 'cancelled'
      )
    ),
  question_count integer not null check (question_count between 4 and 500),
  unit_ids uuid[] not null check (cardinality(unit_ids) between 1 and 500),
  unit_labels text[] not null check (cardinality(unit_labels) between 1 and 500),
  planned_available_from timestamptz not null,
  planned_available_until timestamptz not null,
  effective_available_from timestamptz not null,
  effective_available_until timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  assignment_id uuid references public.assignments(id) on delete restrict,
  completed_attempt_id uuid
    references public.quiz_attempts(id) on delete set null,
  attention_reason text,
  materialized_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint vocab_assignment_series_items_sequence_unique
    unique (series_id, sequence_number),
  constraint vocab_assignment_series_items_assignment_unique
    unique (assignment_id),
  constraint vocab_assignment_series_items_planned_window_check
    check (planned_available_until > planned_available_from),
  constraint vocab_assignment_series_items_effective_window_check
    check (effective_available_until > effective_available_from),
  constraint vocab_assignment_series_items_state_check check (
    (
      status in ('queued', 'ready')
      and assignment_id is null
      and materialized_at is null
      and completed_at is null
      and cancelled_at is null
    )
    or (
      status = 'assigned'
      and assignment_id is not null
      and materialized_at is not null
      and completed_at is null
      and cancelled_at is null
    )
    or (
      status = 'completed'
      and assignment_id is not null
      and materialized_at is not null
      and completed_at is not null
      and cancelled_at is null
    )
    or (
      status = 'attention'
      and completed_at is null
      and cancelled_at is null
    )
    or (
      status = 'cancelled'
      and completed_at is null
      and cancelled_at is not null
    )
  )
);

create table private.vocab_assignment_series_events (
  id uuid primary key default extensions.gen_random_uuid(),
  series_id uuid not null
    references private.vocab_assignment_series(id) on delete restrict,
  item_id uuid
    references private.vocab_assignment_series_items(id) on delete restrict,
  assignment_id uuid references public.assignments(id) on delete set null,
  attempt_id uuid references public.quiz_attempts(id) on delete set null,
  event_kind text not null
    check (
      event_kind in (
        'series.created',
        'session.assigned',
        'session.completed',
        'session.ready',
        'session.attention',
        'session.materialization_failed',
        'session.skipped',
        'series.completed',
        'series.cancelled'
      )
    ),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

create index vocab_assignment_series_student_status_idx
  on private.vocab_assignment_series (student_id, status, updated_at desc);
create index vocab_assignment_series_request_idx
  on private.vocab_assignment_series (request_id, student_id);
create index vocab_assignment_series_items_series_status_idx
  on private.vocab_assignment_series_items
    (series_id, status, sequence_number);
create index vocab_assignment_series_items_ready_idx
  on private.vocab_assignment_series_items (series_id, sequence_number)
  where status = 'ready';
create unique index vocab_assignment_series_items_one_live_idx
  on private.vocab_assignment_series_items (series_id)
  where status in ('ready', 'assigned');
create index vocab_assignment_series_events_series_time_idx
  on private.vocab_assignment_series_events (series_id, occurred_at desc);

revoke all on table private.vocab_assignment_queue_requests
  from public, anon, authenticated, service_role;
revoke all on table private.vocab_assignment_series
  from public, anon, authenticated, service_role;
revoke all on table private.vocab_assignment_series_items
  from public, anon, authenticated, service_role;
revoke all on table private.vocab_assignment_series_events
  from public, anon, authenticated, service_role;

create function private.next_vocab_assignment_queue_window_v1(
  p_recurrence_slots jsonb,
  p_after timestamptz
)
returns table (
  available_from timestamptz,
  available_until timestamptz
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  slot jsonb;
  day_offset integer;
  candidate_date date;
  candidate_from timestamptz;
  candidate_until timestamptz;
  best_from timestamptz;
  best_until timestamptz;
begin
  if p_after is null
    or p_recurrence_slots is null
    or jsonb_typeof(p_recurrence_slots) <> 'array'
    or jsonb_array_length(p_recurrence_slots) not between 1 and 7
  then
    raise exception 'invalid_vocab_queue_recurrence' using errcode = '22023';
  end if;

  for slot in
    select value
    from jsonb_array_elements(p_recurrence_slots)
  loop
    if (slot ->> 'isodow')::integer not between 1 and 7
      or (slot ->> 'duration_seconds')::integer not between 60 and 31536000
      or nullif(slot ->> 'local_time', '') is null
    then
      raise exception 'invalid_vocab_queue_recurrence_slot'
        using errcode = '22023';
    end if;

    for day_offset in 0..7 loop
      candidate_date := (p_after at time zone 'Asia/Seoul')::date + day_offset;
      if extract(isodow from candidate_date)::integer =
        (slot ->> 'isodow')::integer
      then
        candidate_from := (
          candidate_date + (slot ->> 'local_time')::time
        ) at time zone 'Asia/Seoul';
        if candidate_from > p_after
          and (best_from is null or candidate_from < best_from)
        then
          candidate_until := candidate_from + make_interval(
            secs => (slot ->> 'duration_seconds')::integer
          );
          best_from := candidate_from;
          best_until := candidate_until;
        end if;
      end if;
    end loop;
  end loop;

  if best_from is null or best_until is null then
    raise exception 'vocab_queue_next_window_not_found'
      using errcode = '22023';
  end if;

  return query select best_from, best_until;
end;
$$;

create function private.get_vocab_assignment_queue_result_v1(
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.vocab_assignment_queue_requests%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_vocab_queue_lookup' using errcode = '22023';
  end if;

  select request.*
  into request_row
  from private.vocab_assignment_queue_requests as request
  where request.idempotency_key = p_idempotency_key;

  if not found then
    return null;
  end if;
  if request_row.actor_admin_id <> (select auth.uid())
    or request_row.request_sha256 <> p_request_sha256
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  return request_row.result;
end;
$$;

create function public.get_vocab_assignment_queue_result_v1(
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.get_vocab_assignment_queue_result_v1(
    p_idempotency_key,
    p_request_sha256
  );
$$;

create function private.create_vocab_assignment_queues_v1(
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
  request_row private.vocab_assignment_queue_requests%rowtype;
  payload_sha256_value text;
  series_input jsonb;
  item_input jsonb;
  created_series_id uuid;
  created_item_id uuid;
  series_position integer;
  item_position integer;
  item_count integer;
  total_item_count integer;
  total_question_count integer;
  first_batches jsonb := '[]'::jsonb;
  first_result jsonb;
  result_value jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_series is null
    or jsonb_typeof(p_series) <> 'array'
    or jsonb_array_length(p_series) not between 1 and 30
  then
    raise exception 'invalid_vocab_assignment_queue'
      using errcode = '22023';
  end if;

  select
    coalesce(sum(jsonb_array_length(series.value -> 'items')), 0)::integer,
    coalesce(sum((item.value ->> 'question_count')::integer), 0)::integer
  into total_item_count, total_question_count
  from jsonb_array_elements(p_series) as series(value)
  cross join lateral jsonb_array_elements(series.value -> 'items') as item(value);

  if total_item_count not between 1 and 210
    or total_question_count not between 4 and 10000
    or exists (
      select 1
      from jsonb_array_elements(p_series) as series(value)
      where jsonb_typeof(series.value) <> 'object'
        or nullif(series.value ->> 'student_id', '') is null
        or nullif(series.value ->> 'dataset_id', '') is null
        or char_length(trim(coalesce(series.value ->> 'dataset_label', '')))
          not between 1 and 160
        or char_length(trim(coalesce(series.value ->> 'range_label', '')))
          not between 1 and 500
        or jsonb_typeof(series.value -> 'recurrence_slots') <> 'array'
        or jsonb_array_length(series.value -> 'recurrence_slots')
          not between 1 and 7
        or jsonb_typeof(series.value -> 'items') <> 'array'
        or jsonb_array_length(series.value -> 'items') not between 1 and 210
    )
  then
    raise exception 'invalid_vocab_assignment_queue_shape'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    cross join lateral jsonb_array_elements(
      series.value -> 'recurrence_slots'
    ) as slot(value)
    where jsonb_typeof(slot.value) <> 'object'
      or coalesce(case
        when coalesce(slot.value ->> 'isodow', '') ~ '^[1-7]$'
          then (slot.value ->> 'isodow')::integer
        else null
      end, 0) not between 1 and 7
      or coalesce(slot.value ->> 'local_time', '') !~
        '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
      or coalesce(case
        when coalesce(slot.value ->> 'duration_seconds', '') ~ '^[0-9]{1,8}$'
          then (slot.value ->> 'duration_seconds')::integer
        else null
      end, 0) not between 60 and 31536000
  ) then
    raise exception 'invalid_vocab_assignment_queue_recurrence'
      using errcode = '22023';
  end if;

  if (
    select count(distinct (series.value ->> 'student_id')::uuid)
    from jsonb_array_elements(p_series) as series(value)
  ) <> jsonb_array_length(p_series)
  then
    raise exception 'duplicate_vocab_assignment_queue_student'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_series) as series(value)
    cross join lateral jsonb_array_elements(series.value -> 'items')
      with ordinality as item(value, position)
    where jsonb_typeof(item.value) <> 'object'
      or item.value ->> 'kind' <> 'regular'
      or (item.value ->> 'student_id')::uuid <>
        (series.value ->> 'student_id')::uuid
      or (item.value ->> 'dataset_id')::uuid <>
        (series.value ->> 'dataset_id')::uuid
      or (item.value ->> 'session_number')::integer <> item.position
      or (item.value ->> 'session_count')::integer <>
        jsonb_array_length(series.value -> 'items')
      or (item.value ->> 'question_count')::integer not between 4 and 500
      or jsonb_typeof(item.value -> 'questions') <> 'array'
      or jsonb_array_length(item.value -> 'questions') <>
        (item.value ->> 'question_count')::integer
      or jsonb_typeof(item.value -> 'unit_ids') <> 'array'
      or jsonb_array_length(item.value -> 'unit_ids') not between 1 and 500
      or jsonb_typeof(item.value -> 'unit_labels') <> 'array'
      or jsonb_array_length(item.value -> 'unit_labels') not between 1 and 500
      or jsonb_typeof(coalesce(
        item.value -> 'allowed_collision_assignment_ids',
        '[]'::jsonb
      )) <> 'array'
      or (item.value ->> 'available_until')::timestamptz <=
        (item.value ->> 'available_from')::timestamptz
  ) then
    raise exception 'invalid_vocab_assignment_queue_item'
      using errcode = '22023';
  end if;

  payload_sha256_value := encode(
    extensions.digest(convert_to(p_series::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into private.vocab_assignment_queue_requests (
    idempotency_key,
    request_sha256,
    payload_sha256,
    actor_admin_id
  ) values (
    p_idempotency_key,
    p_request_sha256,
    payload_sha256_value,
    (select auth.uid())
  ) on conflict (idempotency_key) do nothing;

  select request.*
  into request_row
  from private.vocab_assignment_queue_requests as request
  where request.idempotency_key = p_idempotency_key
  for update;

  if request_row.actor_admin_id <> (select auth.uid())
    or request_row.request_sha256 <> p_request_sha256
    or request_row.payload_sha256 <> payload_sha256_value
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.result is not null then
    return request_row.result;
  end if;

  for series_input, series_position in
    select value, position::integer
    from jsonb_array_elements(p_series) with ordinality
      as input(value, position)
    order by (value ->> 'student_id')::uuid
  loop
    item_count := jsonb_array_length(series_input -> 'items');
    insert into private.vocab_assignment_series (
      request_id,
      student_id,
      dataset_id,
      exam_use_release_id,
      actor_admin_id,
      dataset_label,
      range_label,
      recurrence_slots
    ) values (
      p_idempotency_key,
      (series_input ->> 'student_id')::uuid,
      (series_input ->> 'dataset_id')::uuid,
      (
        select release.release_id
        from word_index.app_exam_use_release as release
        where release.dataset_id = (series_input ->> 'dataset_id')::uuid
          and release.status = 'active'
        order by release.created_at_utc desc, release.release_id
        limit 1
      ),
      (select auth.uid()),
      trim(series_input ->> 'dataset_label'),
      trim(series_input ->> 'range_label'),
      series_input -> 'recurrence_slots'
    ) returning id into created_series_id;

    insert into private.vocab_assignment_series_events (
      series_id,
      event_kind,
      details
    ) values (
      created_series_id,
      'series.created',
      jsonb_build_object(
        'sessionCount', item_count,
        'requestId', p_idempotency_key
      )
    );

    for item_input, item_position in
      select value, position::integer
      from jsonb_array_elements(series_input -> 'items') with ordinality
        as input(value, position)
      order by position
    loop
      insert into private.vocab_assignment_series_items (
        series_id,
        sequence_number,
        status,
        question_count,
        unit_ids,
        unit_labels,
        planned_available_from,
        planned_available_until,
        effective_available_from,
        effective_available_until,
        payload
      ) values (
        created_series_id,
        item_position,
        'queued',
        (item_input ->> 'question_count')::integer,
        array(
          select value::uuid
          from jsonb_array_elements_text(item_input -> 'unit_ids')
            as unit(value)
        ),
        array(
          select value
          from jsonb_array_elements_text(item_input -> 'unit_labels')
            as unit(value)
        ),
        (item_input ->> 'available_from')::timestamptz,
        (item_input ->> 'available_until')::timestamptz,
        (item_input ->> 'available_from')::timestamptz,
        (item_input ->> 'available_until')::timestamptz,
        item_input
      ) returning id into created_item_id;

      if item_position = 1 then
        -- The legacy bulk writer requires every submitted student series to be
        -- complete.  This queue intentionally materializes only the first
        -- step, so present that internal write as a one-step batch while the
        -- queue keeps the real session count in the original payload.
        first_batches := first_batches || jsonb_build_array(
          jsonb_set(item_input, '{session_count}', '1'::jsonb)
        );
      end if;
    end loop;
  end loop;

  first_result := private.create_bulk_vocab_assignments_v8(
    p_idempotency_key,
    p_request_sha256,
    first_batches
  );

  if jsonb_array_length(first_result) <> jsonb_array_length(p_series) then
    raise exception 'vocab_assignment_queue_first_result_mismatch'
      using errcode = '21000';
  end if;

  update private.vocab_assignment_series_items as item
  set status = 'assigned',
      assignment_id = result.assignment_id,
      materialized_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from private.vocab_assignment_series as series,
    jsonb_to_recordset(first_result) as result(
      student_id uuid,
      assignment_id uuid,
      session_number integer
    )
  where item.series_id = series.id
    and series.request_id = p_idempotency_key
    and series.student_id = result.student_id
    and item.sequence_number = 1
    and result.session_number = 1;

  if (
    select count(*)
    from private.vocab_assignment_series_items as item
    join private.vocab_assignment_series as series on series.id = item.series_id
    where series.request_id = p_idempotency_key
      and item.sequence_number = 1
      and item.status = 'assigned'
  ) <> jsonb_array_length(p_series) then
    raise exception 'vocab_assignment_queue_first_link_mismatch'
      using errcode = '21000';
  end if;

  insert into private.vocab_assignment_series_events (
    series_id,
    item_id,
    assignment_id,
    event_kind,
    details
  )
  select
    series.id,
    item.id,
    item.assignment_id,
    'session.assigned',
    jsonb_build_object('sequenceNumber', item.sequence_number)
  from private.vocab_assignment_series as series
  join private.vocab_assignment_series_items as item
    on item.series_id = series.id
   and item.sequence_number = 1
  where series.request_id = p_idempotency_key;

  select jsonb_agg(
    jsonb_build_object(
      'student_id', series.student_id,
      'assignment_id', item.assignment_id,
      'queue_series_id', series.id,
      'queue_item_id', item.id,
      'session_number', item.sequence_number,
      'status', item.status
    ) order by series.student_id, item.sequence_number
  )
  into result_value
  from private.vocab_assignment_series as series
  join private.vocab_assignment_series_items as item
    on item.series_id = series.id
  where series.request_id = p_idempotency_key;

  update private.vocab_assignment_queue_requests
  set result = result_value,
      completed_at = clock_timestamp()
  where idempotency_key = p_idempotency_key;

  insert into public.audit_events (event_type, actor_admin_id, details)
  values (
    'assignment.vocab_completion_queue_created',
    (select auth.uid()),
    jsonb_build_object(
      'idempotencyKey', p_idempotency_key,
      'studentCount', jsonb_array_length(p_series),
      'sessionCount', total_item_count,
      'questionCount', total_question_count
    )
  );

  return result_value;
end;
$$;

create function public.create_vocab_assignment_queues_v1(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_series jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_vocab_assignment_queues_v1(
    p_idempotency_key,
    p_request_sha256,
    p_series
  );
$$;

create function private.mark_vocab_assignment_queue_completed_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_item private.vocab_assignment_series_items%rowtype;
  current_series private.vocab_assignment_series%rowtype;
  next_item private.vocab_assignment_series_items%rowtype;
  shifted_from timestamptz;
  shifted_until timestamptz;
  schedule_failure_code text;
begin
  select item.*
  into current_item
  from private.vocab_assignment_series_items as item
  join private.vocab_assignment_series as series on series.id = item.series_id
  where item.assignment_id = new.assignment_id
    and series.student_id = new.student_id;

  if not found then
    return new;
  end if;

  select series.*
  into current_series
  from private.vocab_assignment_series as series
  where series.id = current_item.series_id
  for update;

  select item.*
  into current_item
  from private.vocab_assignment_series_items as item
  where item.id = current_item.id
  for update;

  if current_series.status not in ('active', 'attention')
    or current_item.status <> 'assigned'
  then
    return new;
  end if;

  if new.status = 'expired' then
    update private.vocab_assignment_series_items
    set status = 'attention',
        attention_reason = 'assignment_expired',
        updated_at = clock_timestamp()
    where id = current_item.id;
    update private.vocab_assignment_series
    set status = 'attention',
        attention_reason = 'assignment_expired',
        updated_at = clock_timestamp()
    where id = current_series.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      attempt_id,
      event_kind,
      details
    ) values (
      current_series.id,
      current_item.id,
      new.assignment_id,
      new.id,
      'session.attention',
      jsonb_build_object('reason', 'assignment_expired')
    );
    return new;
  end if;

  update private.vocab_assignment_series_items
  set status = 'completed',
      completed_attempt_id = new.id,
      completed_at = new.completed_at,
      attention_reason = null,
      updated_at = clock_timestamp()
  where id = current_item.id;

  insert into private.vocab_assignment_series_events (
    series_id,
    item_id,
    assignment_id,
    attempt_id,
    event_kind,
    details
  ) values (
    current_series.id,
    current_item.id,
    new.assignment_id,
    new.id,
    'session.completed',
    jsonb_build_object('sequenceNumber', current_item.sequence_number)
  );

  select item.*
  into next_item
  from private.vocab_assignment_series_items as item
  where item.series_id = current_series.id
    and item.status = 'queued'
    and item.sequence_number > current_item.sequence_number
  order by item.sequence_number
  limit 1
  for update;

  if not found then
    update private.vocab_assignment_series
    set status = 'completed',
        attention_reason = null,
        completed_at = new.completed_at,
        updated_at = clock_timestamp()
    where id = current_series.id;

    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      attempt_id,
      event_kind,
      details
    ) values (
      current_series.id,
      current_item.id,
      new.assignment_id,
      new.id,
      'series.completed',
      '{}'::jsonb
    );
    return new;
  end if;

  shifted_from := next_item.planned_available_from;
  shifted_until := next_item.planned_available_until;
  if shifted_until <= new.completed_at then
    begin
      select next_window.available_from, next_window.available_until
      into shifted_from, shifted_until
      from private.next_vocab_assignment_queue_window_v1(
        current_series.recurrence_slots,
        new.completed_at
      ) as next_window;
    exception when others then
      get stacked diagnostics schedule_failure_code = returned_sqlstate;
      update private.vocab_assignment_series_items
      set status = 'attention',
          attention_reason = 'schedule_invalid',
          updated_at = clock_timestamp()
      where id = next_item.id;
      update private.vocab_assignment_series
      set status = 'attention',
          attention_reason = 'schedule_invalid',
          updated_at = clock_timestamp()
      where id = current_series.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        current_series.id,
        next_item.id,
        'session.attention',
        jsonb_build_object(
          'reason', 'schedule_invalid',
          'sqlstate', schedule_failure_code
        )
      );
      return new;
    end;
  end if;

  update private.vocab_assignment_series_items
  set status = 'ready',
      effective_available_from = shifted_from,
      effective_available_until = shifted_until,
      attention_reason = null,
      updated_at = clock_timestamp()
  where id = next_item.id;

  update private.vocab_assignment_series
  set status = 'active',
      attention_reason = null,
      updated_at = clock_timestamp()
  where id = current_series.id;

  insert into private.vocab_assignment_series_events (
    series_id,
    item_id,
    event_kind,
    details
  ) values (
    current_series.id,
    next_item.id,
    'session.ready',
    jsonb_build_object(
      'sequenceNumber', next_item.sequence_number,
      'scheduleShifted', shifted_from is distinct from
        next_item.planned_available_from
    )
  );

  return new;
end;
$$;

create trigger quiz_attempts_advance_vocab_assignment_queue
after update of status on public.quiz_attempts
for each row
when (
  old.status is distinct from new.status
  and new.status in ('completed', 'expired')
  and new.completed_at is not null
)
execute function private.mark_vocab_assignment_queue_completed_v1();

create function private.pause_vocab_assignment_queue_after_link_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row private.vocab_assignment_series_items%rowtype;
  reason_value text;
begin
  if not (
    (old.cancelled_at is null and new.cancelled_at is not null)
    or (old.missed_at is null and new.missed_at is not null)
  ) then
    return new;
  end if;

  select item.*
  into item_row
  from private.vocab_assignment_series_items as item
  where item.assignment_id = new.assignment_id
    and item.status = 'assigned'
  for update;
  if not found then
    return new;
  end if;

  reason_value := case
    when new.cancelled_at is not null then 'assignment_cancelled'
    else 'assignment_missed'
  end;

  update private.vocab_assignment_series_items
  set status = 'attention',
      attention_reason = reason_value,
      updated_at = clock_timestamp()
  where id = item_row.id;

  update private.vocab_assignment_series
  set status = 'attention',
      attention_reason = reason_value,
      updated_at = clock_timestamp()
  where id = item_row.series_id
    and status = 'active';

  insert into private.vocab_assignment_series_events (
    series_id,
    item_id,
    assignment_id,
    event_kind,
    details
  ) values (
    item_row.series_id,
    item_row.id,
    new.assignment_id,
    'session.attention',
    jsonb_build_object('reason', reason_value)
  );
  return new;
end;
$$;

create trigger assignment_students_pause_vocab_assignment_queue
after update of cancelled_at, missed_at on public.assignment_students
for each row execute function
  private.pause_vocab_assignment_queue_after_link_change_v1();

-- The student answer path runs as service_role and has no administrator JWT.
-- Build explicit-actor core writers instead of mutating request JWT claims or
-- calling the administrator wrapper from the completion workflow.
do $migration$
declare
  function_definition text;
  admin_check text := E'  if not (select private.is_active_admin()) then\n    raise exception ''forbidden'' using errcode = ''42501'';\n  end if;\n\n';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  ) into function_definition;

  if position(admin_check in function_definition) = 0
    or position('(select auth.uid())' in function_definition) = 0
  then
    raise exception 'assignment_question_bank_core_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_assignment_with_question_bank(',
    'private.create_assignment_with_question_bank_system_v1(p_actor_admin_id uuid, '
  );
  function_definition := replace(function_definition, admin_check, '');
  function_definition := replace(
    function_definition,
    '(select auth.uid())',
    'p_actor_admin_id'
  );

  if position('private.is_active_admin()' in function_definition) > 0
    or position('(select auth.uid())' in function_definition) > 0
    or position(
      'private.create_assignment_with_question_bank_system_v1('
      in function_definition
    ) = 0
  then
    raise exception 'assignment_question_bank_system_core_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  admin_check text := E'  if not (select private.is_active_admin()) then\n    raise exception ''forbidden'' using errcode = ''42501'';\n  end if;\n\n';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_question_bank_v2(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  ) into function_definition;

  if position(admin_check in function_definition) = 0
    or position(
      'private.create_assignment_with_question_bank('
      in function_definition
    ) = 0
    or position('(select auth.uid())' in function_definition) = 0
  then
    raise exception 'assignment_question_bank_v2_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_assignment_with_question_bank_v2(',
    'private.create_assignment_with_question_bank_v2_system_v1(p_actor_admin_id uuid, '
  );
  function_definition := replace(function_definition, admin_check, '');
  function_definition := replace(
    function_definition,
    'private.create_assignment_with_question_bank(',
    'private.create_assignment_with_question_bank_system_v1(p_actor_admin_id, '
  );
  function_definition := replace(
    function_definition,
    '(select auth.uid())',
    'p_actor_admin_id'
  );

  if position('private.is_active_admin()' in function_definition) > 0
    or position('(select auth.uid())' in function_definition) > 0
    or position(
      'private.create_assignment_with_question_bank_system_v1(p_actor_admin_id, '
      in function_definition
    ) = 0
  then
    raise exception 'assignment_question_bank_v2_system_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  admin_check text := E'  if not (select private.is_active_admin()) then\n    raise exception ''forbidden'' using errcode = ''42501'';\n  end if;\n\n';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_question_bank_v3(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  ) into function_definition;

  if position(admin_check in function_definition) = 0
    or position(
      'private.create_assignment_with_question_bank_v2('
      in function_definition
    ) = 0
  then
    raise exception 'assignment_question_bank_v3_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_assignment_with_question_bank_v3(',
    'private.create_assignment_with_question_bank_v3_system_v1(p_actor_admin_id uuid, '
  );
  function_definition := replace(function_definition, admin_check, '');
  function_definition := replace(
    function_definition,
    'private.create_assignment_with_question_bank_v2(',
    'private.create_assignment_with_question_bank_v2_system_v1(p_actor_admin_id, '
  );
  function_definition := replace(
    function_definition,
    '(select auth.uid())',
    'p_actor_admin_id'
  );

  if position('private.is_active_admin()' in function_definition) > 0
    or position('(select auth.uid())' in function_definition) > 0
    or position(
      'private.create_assignment_with_question_bank_v2_system_v1(p_actor_admin_id, '
      in function_definition
    ) = 0
  then
    raise exception 'assignment_question_bank_v3_system_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  admin_check text := E'  if not (select private.is_active_admin()) then\n    raise exception ''forbidden'' using errcode = ''42501'';\n  end if;\n\n';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_exam_use_question_bank_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  ) into function_definition;

  if position(admin_check in function_definition) = 0
    or position(
      'private.create_assignment_with_question_bank('
      in function_definition
    ) = 0
    or position('(select auth.uid())' in function_definition) = 0
  then
    raise exception 'assignment_exam_use_bank_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_assignment_with_exam_use_question_bank_v1(',
    'private.create_assignment_with_exam_use_question_bank_system_v1(p_actor_admin_id uuid, '
  );
  function_definition := replace(function_definition, admin_check, '');
  function_definition := replace(
    function_definition,
    'private.create_assignment_with_question_bank(',
    'private.create_assignment_with_question_bank_system_v1(p_actor_admin_id, '
  );
  function_definition := replace(
    function_definition,
    '(select auth.uid())',
    'p_actor_admin_id'
  );

  if position('private.is_active_admin()' in function_definition) > 0
    or position('(select auth.uid())' in function_definition) > 0
    or position(
      'private.create_assignment_with_question_bank_system_v1(p_actor_admin_id, '
      in function_definition
    ) = 0
  then
    raise exception 'assignment_exam_use_bank_system_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

create function private.create_assignment_with_question_bank_dispatch_system_v1(
  p_actor_admin_id uuid,
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_release_id uuid;
begin
  select release.release_id
  into active_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
  for share;

  if active_release_id is null then
    if exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    ) then
      raise exception 'exam_use_release_inactive' using errcode = '55000';
    end if;
    return private.create_assignment_with_question_bank_v3_system_v1(
      p_actor_admin_id,
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    );
  end if;

  return private.create_assignment_with_exam_use_question_bank_system_v1(
    p_actor_admin_id,
    active_release_id,
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_questions
  );
end;
$$;

create function private.create_assignment_with_delivery_system_v1(
  p_actor_admin_id uuid,
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
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
  locked_student_count integer;
begin
  if p_actor_admin_id is null or not exists (
    select 1
    from public.admin_profiles as admin
    where admin.user_id = p_actor_admin_id
      and admin.is_active
  ) then
    raise exception 'queue_actor_admin_inactive' using errcode = '42501';
  end if;
  if p_student_ids is null
    or cardinality(p_student_ids) < 1
    or cardinality(p_student_ids) <> (
      select count(distinct student_id)
      from unnest(p_student_ids) as input(student_id)
      where student_id is not null
    )
  then
    raise exception 'invalid_assignment_students' using errcode = '22023';
  end if;
  if p_timing_mode not in ('total', 'per_question')
    or (p_timing_mode = 'total' and p_question_time_limit_seconds is not null)
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

  perform student.id
  from public.students as student
  where student.id = any(p_student_ids)
    and student.status = 'active'
    and student.deleted_at is null
  order by student.id
  for update;
  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(p_student_ids)
    and student.status = 'active'
    and student.deleted_at is null;
  if locked_student_count <> cardinality(p_student_ids) then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  perform private.assert_assignment_words_available_v2(
    p_student_ids,
    p_dataset_id,
    p_questions
  );
  created_assignment_id :=
    private.create_assignment_with_question_bank_dispatch_system_v1(
      p_actor_admin_id,
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    );

  update public.assignments
  set timing_mode = p_timing_mode,
      question_time_limit_seconds = p_question_time_limit_seconds,
      updated_at = clock_timestamp()
  where id = created_assignment_id;

  insert into public.audit_events (event_type, actor_admin_id, details)
  values (
    'assignment.regular_queue_system_v1_created',
    p_actor_admin_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'studentIds', to_jsonb(p_student_ids),
      'timingMode', p_timing_mode,
      'automated', true
    )
  );
  return created_assignment_id;
end;
$$;

create function private.materialize_ready_vocab_assignment_queue_v1(
  p_student_id uuid,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  series_row private.vocab_assignment_series%rowtype;
  item_row private.vocab_assignment_series_items%rowtype;
  created_assignment_id uuid;
  current_release_id uuid;
  failure_code text;
  failure_reason text;
  shifted_from timestamptz;
  shifted_until timestamptz;
  updated_assignment_count integer;
  results jsonb := '[]'::jsonb;
begin
  if p_student_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_vocab_queue_materialize_request'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
    and student.deleted_at is null
  for update;
  if not found then
    return '[]'::jsonb;
  end if;

  for series_row in
    select series.*
    from private.vocab_assignment_series as series
    where series.student_id = p_student_id
      and series.status = 'active'
      and exists (
        select 1
        from private.vocab_assignment_series_items as item
        where item.series_id = series.id
          and item.status = 'ready'
      )
    order by series.created_at, series.id
    for update skip locked
    limit p_limit
  loop
    select item.*
    into item_row
    from private.vocab_assignment_series_items as item
    where item.series_id = series_row.id
      and item.status = 'ready'
    order by item.sequence_number
    limit 1
    for update;
    if not found then
      continue;
    end if;

    failure_code := null;
    if not exists (
      select 1
      from public.admin_profiles as admin
      where admin.user_id = series_row.actor_admin_id
        and admin.is_active
    ) then
      failure_reason := 'admin_inactive';
    else
      failure_reason := null;
    end if;

    select release.release_id
    into current_release_id
    from word_index.app_exam_use_release as release
    where release.dataset_id = series_row.dataset_id
      and release.status = 'active'
    order by release.created_at_utc desc, release.release_id
    limit 1
    for share;
    if failure_reason is null
      and current_release_id is distinct from series_row.exam_use_release_id
    then
      failure_reason := 'content_release_changed';
    end if;

    shifted_from := item_row.effective_available_from;
    shifted_until := item_row.effective_available_until;
    if failure_reason is null and shifted_until <= clock_timestamp() then
      begin
        select next_window.available_from, next_window.available_until
        into shifted_from, shifted_until
        from private.next_vocab_assignment_queue_window_v1(
          series_row.recurrence_slots,
          clock_timestamp()
        ) as next_window;
        update private.vocab_assignment_series_items
        set effective_available_from = shifted_from,
            effective_available_until = shifted_until,
            updated_at = clock_timestamp()
        where id = item_row.id;
      exception when others then
        get stacked diagnostics failure_code = returned_sqlstate;
        failure_reason := 'schedule_invalid';
      end;
    end if;

    if failure_reason is null and exists (
      select 1
      from public.assignment_students as link
      join public.assignments as assignment on assignment.id = link.assignment_id
      where link.student_id = p_student_id
        and link.cancelled_at is null
        and link.missed_at is null
        and assignment.deleted_at is null
        and (
          coalesce(assignment.available_from, link.assigned_at)
            at time zone 'Asia/Seoul'
        )::date = (shifted_from at time zone 'Asia/Seoul')::date
        and (
          not exists (
            select 1
            from public.quiz_attempts as attempt
            where attempt.assignment_id = link.assignment_id
              and attempt.student_id = link.student_id
          )
          or exists (
            select 1
            from public.quiz_attempts as attempt
            where attempt.assignment_id = link.assignment_id
              and attempt.student_id = link.student_id
              and attempt.status = 'in_progress'
          )
        )
        and not exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(
              item_row.payload -> 'allowed_collision_assignment_ids',
              '[]'::jsonb
            )
          ) as allowed(assignment_id)
          where allowed.assignment_id = assignment.id::text
        )
    ) then
      failure_reason := 'schedule_conflict';
    end if;

    if failure_reason is null then
      begin
        created_assignment_id := private.create_assignment_with_delivery_system_v1(
          series_row.actor_admin_id,
          item_row.payload ->> 'title',
          series_row.dataset_id,
          item_row.unit_ids,
          item_row.question_count,
          (item_row.payload ->> 'english_to_korean_ratio')::smallint,
          (item_row.payload ->> 'time_limit_seconds')::integer,
          (item_row.payload ->> 'passing_score')::smallint,
          (item_row.payload ->> 'question_order_mode')::public.question_order_mode,
          shifted_until,
          array[p_student_id],
          item_row.payload ->> 'timing_mode',
          nullif(
            item_row.payload ->> 'question_time_limit_seconds',
            ''
          )::integer,
          item_row.payload -> 'questions'
        );
        perform private.align_assignment_unit_direction_v1(
          created_assignment_id,
          series_row.dataset_id,
          item_row.unit_ids
        );
        update public.assignments as assignment
        set available_from = shifted_from
        where assignment.id = created_assignment_id
          and assignment.available_until is not distinct from shifted_until;
        get diagnostics updated_assignment_count = row_count;
        if updated_assignment_count <> 1 then
          raise exception 'vocab_queue_schedule_write_failed'
            using errcode = '21000';
        end if;
      exception when others then
        get stacked diagnostics failure_code = returned_sqlstate;
        failure_reason := case
          when failure_code = '40001' then 'schedule_conflict'
          when failure_code in ('22023', '55000') then 'content_unavailable'
          else 'materialization_failed'
        end;
      end;
    end if;

    if failure_reason = 'materialization_failed' then
      -- Keep transient failures retryable. Student dashboard loads and a
      -- later completion callback can safely call the materializer again.
      update private.vocab_assignment_series_items
      set status = 'ready',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = item_row.id;
      update private.vocab_assignment_series
      set status = 'active',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        item_row.id,
        'session.materialization_failed',
        jsonb_build_object(
          'reason', failure_reason,
          'sqlstate', failure_code
        )
      );
      results := results || jsonb_build_array(jsonb_build_object(
        'series_id', series_row.id,
        'item_id', item_row.id,
        'assignment_id', null,
        'status', 'ready'
      ));
      continue;
    end if;

    if failure_reason is not null then
      update private.vocab_assignment_series_items
      set status = 'attention',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = item_row.id;
      update private.vocab_assignment_series
      set status = 'attention',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        item_row.id,
        'session.attention',
        jsonb_build_object(
          'reason', failure_reason,
          'sqlstate', failure_code
        )
      );
      results := results || jsonb_build_array(jsonb_build_object(
        'series_id', series_row.id,
        'item_id', item_row.id,
        'assignment_id', null,
        'status', 'attention'
      ));
      continue;
    end if;

    update private.vocab_assignment_series_items
    set status = 'assigned',
        assignment_id = created_assignment_id,
        materialized_at = clock_timestamp(),
        attention_reason = null,
        updated_at = clock_timestamp()
    where id = item_row.id;
    update private.vocab_assignment_series
    set status = 'active',
        attention_reason = null,
        updated_at = clock_timestamp()
    where id = series_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      created_assignment_id,
      'session.assigned',
      jsonb_build_object('sequenceNumber', item_row.sequence_number)
    );
    insert into public.audit_events (event_type, actor_admin_id, details)
    values (
      'assignment.vocab_completion_queue_materialized',
      series_row.actor_admin_id,
      jsonb_build_object(
        'seriesId', series_row.id,
        'itemId', item_row.id,
        'assignmentId', created_assignment_id,
        'studentId', p_student_id,
        'automated', true
      )
    );
    results := results || jsonb_build_array(jsonb_build_object(
      'series_id', series_row.id,
      'item_id', item_row.id,
      'assignment_id', created_assignment_id,
      'status', 'assigned'
    ));
  end loop;

  return results;
end;
$$;

create function public.materialize_ready_vocab_assignment_queue_v1(
  p_student_id uuid,
  p_limit integer default 10
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.materialize_ready_vocab_assignment_queue_v1(
    p_student_id,
    p_limit
  );
$$;

create function private.resolve_vocab_assignment_queue_attention_v1(
  p_series_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  series_row private.vocab_assignment_series%rowtype;
  item_row private.vocab_assignment_series_items%rowtype;
  next_item private.vocab_assignment_series_items%rowtype;
  previous_assignment_id uuid;
  current_release_id uuid;
  shifted_from timestamptz;
  shifted_until timestamptz;
  resolved_at timestamptz := clock_timestamp();
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

  select series.*
  into series_row
  from private.vocab_assignment_series as series
  where series.id = p_series_id
  for update;
  if not found or series_row.status <> 'attention' then
    raise exception 'vocab_queue_attention_not_found'
      using errcode = 'P0002';
  end if;

  select item.*
  into item_row
  from private.vocab_assignment_series_items as item
  where item.series_id = series_row.id
    and item.status = 'attention'
  order by item.sequence_number
  limit 1
  for update;
  if not found then
    raise exception 'vocab_queue_attention_item_not_found'
      using errcode = 'P0002';
  end if;

  if p_action = 'cancel' then
    update private.vocab_assignment_series_items
    set status = 'cancelled',
        attention_reason = null,
        cancelled_at = resolved_at,
        updated_at = resolved_at
    where series_id = series_row.id
      and status not in ('completed', 'cancelled');
    update private.vocab_assignment_series
    set status = 'cancelled',
        attention_reason = null,
        completed_at = null,
        cancelled_at = resolved_at,
        updated_at = resolved_at
    where id = series_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      item_row.assignment_id,
      'series.cancelled',
      jsonb_build_object('action', p_action)
    );
  elsif p_action = 'retry' then
    previous_assignment_id := item_row.assignment_id;
    select next_window.available_from, next_window.available_until
    into shifted_from, shifted_until
    from private.next_vocab_assignment_queue_window_v1(
      series_row.recurrence_slots,
      resolved_at
    ) as next_window;

    select release.release_id
    into current_release_id
    from word_index.app_exam_use_release as release
    where release.dataset_id = series_row.dataset_id
      and release.status = 'active'
    order by release.created_at_utc desc, release.release_id
    limit 1;

    update private.vocab_assignment_series_items
    set status = 'ready',
        assignment_id = null,
        completed_attempt_id = null,
        effective_available_from = shifted_from,
        effective_available_until = shifted_until,
        attention_reason = null,
        materialized_at = null,
        completed_at = null,
        cancelled_at = null,
        updated_at = resolved_at
    where id = item_row.id;
    update private.vocab_assignment_series
    set actor_admin_id = (select auth.uid()),
        exam_use_release_id = current_release_id,
        status = 'active',
        attention_reason = null,
        updated_at = resolved_at
    where id = series_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      previous_assignment_id,
      'session.ready',
      jsonb_build_object(
        'action', p_action,
        'sequenceNumber', item_row.sequence_number,
        'scheduleShifted', true
      )
    );
  else
    update private.vocab_assignment_series_items
    set status = 'cancelled',
        attention_reason = null,
        cancelled_at = resolved_at,
        updated_at = resolved_at
    where id = item_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      item_row.assignment_id,
      'session.skipped',
      jsonb_build_object(
        'action', p_action,
        'sequenceNumber', item_row.sequence_number
      )
    );

    select item.*
    into next_item
    from private.vocab_assignment_series_items as item
    where item.series_id = series_row.id
      and item.status = 'queued'
      and item.sequence_number > item_row.sequence_number
    order by item.sequence_number
    limit 1
    for update;
    if not found then
      update private.vocab_assignment_series
      set status = 'completed',
          attention_reason = null,
          completed_at = resolved_at,
          cancelled_at = null,
          updated_at = resolved_at
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        item_row.id,
        'series.completed',
        jsonb_build_object('action', p_action)
      );
    else
      shifted_from := next_item.planned_available_from;
      shifted_until := next_item.planned_available_until;
      if shifted_until <= resolved_at then
        select next_window.available_from, next_window.available_until
        into shifted_from, shifted_until
        from private.next_vocab_assignment_queue_window_v1(
          series_row.recurrence_slots,
          resolved_at
        ) as next_window;
      end if;
      update private.vocab_assignment_series_items
      set status = 'ready',
          effective_available_from = shifted_from,
          effective_available_until = shifted_until,
          attention_reason = null,
          updated_at = resolved_at
      where id = next_item.id;
      update private.vocab_assignment_series
      set actor_admin_id = (select auth.uid()),
          status = 'active',
          attention_reason = null,
          updated_at = resolved_at
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        next_item.id,
        'session.ready',
        jsonb_build_object(
          'action', p_action,
          'sequenceNumber', next_item.sequence_number,
          'scheduleShifted', shifted_from is distinct from
            next_item.planned_available_from
        )
      );
    end if;
  end if;

  insert into public.audit_events (event_type, actor_admin_id, details)
  values (
    'assignment.vocab_completion_queue_resolved',
    (select auth.uid()),
    jsonb_build_object(
      'seriesId', series_row.id,
      'studentId', series_row.student_id,
      'action', p_action
    )
  );
  return jsonb_build_object(
    'series_id', series_row.id,
    'student_id', series_row.student_id,
    'action', p_action
  );
end;
$$;

create function public.resolve_vocab_assignment_queue_attention_v1(
  p_series_id uuid,
  p_action text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.resolve_vocab_assignment_queue_attention_v1(
    p_series_id,
    p_action
  );
$$;

create function public.list_vocab_assignment_queue_summaries_v1(
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
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (p_before_updated_at is null) <> (p_before_series_id is null) then
    raise exception 'invalid queue history cursor' using errcode = '22023';
  end if;
  if p_limit is not null and (p_limit < 1 or p_limit > 101) then
    raise exception 'invalid queue history limit' using errcode = '22023';
  end if;

  return query
  with selected_series as (
    select series.*
    from private.vocab_assignment_series as series
    where (p_student_id is null or series.student_id = p_student_id)
      and (p_include_closed or series.status in ('active', 'attention'))
      and (
        p_before_updated_at is null
        or (series.updated_at, series.id) <
          (p_before_updated_at, p_before_series_id)
      )
    order by series.updated_at desc, series.id desc
    limit p_limit
  )
  select
    series.id,
    series.student_id,
    series.status,
    series.attention_reason,
    series.dataset_label,
    series.range_label,
    count(item.id)::integer,
    count(item.id) filter (where item.status = 'completed')::integer,
    count(item.id) filter (
      where item.status not in ('completed', 'cancelled')
    )::integer,
    coalesce(sum(item.question_count), 0)::integer,
    coalesce(sum(item.question_count) filter (
      where item.status not in ('completed', 'cancelled')
    ), 0)::integer,
    (array_agg(item.assignment_id order by item.sequence_number) filter (
      where item.status = 'assigned'
    ))[1],
    (array_agg(item.effective_available_from order by item.sequence_number)
      filter (where item.status not in ('completed', 'cancelled')))[1],
    (array_agg(item.effective_available_until order by item.sequence_number)
      filter (where item.status not in ('completed', 'cancelled')))[1],
    jsonb_agg(
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
    series.created_at,
    series.updated_at
  from selected_series as series
  join private.vocab_assignment_series_items as item
    on item.series_id = series.id
  group by series.id, series.student_id, series.status,
    series.attention_reason, series.dataset_label, series.range_label,
    series.created_at, series.updated_at
  order by series.updated_at desc, series.id desc;
end;
$$;

revoke all on function private.next_vocab_assignment_queue_window_v1(
  jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.get_vocab_assignment_queue_result_v1(
  uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.create_vocab_assignment_queues_v1(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.mark_vocab_assignment_queue_completed_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.pause_vocab_assignment_queue_after_link_change_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.materialize_ready_vocab_assignment_queue_v1(
  uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.resolve_vocab_assignment_queue_attention_v1(
  uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_question_bank_system_v1(
  uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_question_bank_v2_system_v1(
  uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_question_bank_v3_system_v1(
  uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_exam_use_question_bank_system_v1(
  uuid, uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_question_bank_dispatch_system_v1(
  uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_delivery_system_v1(
  uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.get_vocab_assignment_queue_result_v1(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.get_vocab_assignment_queue_result_v1(
  uuid, text
) to authenticated, service_role;
revoke all on function public.create_vocab_assignment_queues_v1(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_vocab_assignment_queues_v1(
  uuid, text, jsonb
) to authenticated, service_role;
revoke all on function public.materialize_ready_vocab_assignment_queue_v1(
  uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.materialize_ready_vocab_assignment_queue_v1(
  uuid, integer
) to service_role;
revoke all on function public.resolve_vocab_assignment_queue_attention_v1(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_vocab_assignment_queue_attention_v1(
  uuid, text
) to authenticated, service_role;
revoke all on function public.list_vocab_assignment_queue_summaries_v1(
  boolean, uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_vocab_assignment_queue_summaries_v1(
  boolean, uuid, timestamptz, uuid, integer
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
