begin;

create table private.bulk_vocab_series_requests (
  idempotency_key uuid primary key,
  request_sha256 text not null
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text not null
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_admin_id uuid not null references auth.users(id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint bulk_vocab_series_requests_result_check check (
    (result is null and completed_at is null)
    or (jsonb_typeof(result) = 'array' and completed_at is not null)
  )
);

revoke all on table private.bulk_vocab_series_requests
  from public, anon, authenticated, service_role;

-- Scheduled regular sessions must not reserve pending wrong-word queues.
-- Clone the final regular writer fail-closed and remove only that linker.
do $migration$
declare
  function_definition text;
  linker_call text := E'  perform private.link_pending_review_targets_v2(\n    created_assignment_id,\n    p_student_ids,\n    null\n  );\n\n';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_delivery_v6(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(linker_call in function_definition) = 0
    or position(
      'private.assert_assignment_target_prompts_unambiguous_v1('
      in function_definition
    ) = 0
  then
    raise exception 'assignment_delivery_v6_series_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_assignment_with_delivery_v6(',
    'private.create_assignment_with_delivery_v7('
  );
  function_definition := replace(function_definition, linker_call, '');
  function_definition := replace(
    function_definition,
    'assignment.regular_v6_created',
    'assignment.regular_series_v7_created'
  );

  if position(linker_call in function_definition) > 0
    or position(
      'private.create_assignment_with_delivery_v6('
      in function_definition
    ) > 0
  then
    raise exception 'assignment_delivery_v7_series_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

revoke all on function private.create_assignment_with_delivery_v7(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;

create function private.get_bulk_vocab_series_result_v1(
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.bulk_vocab_series_requests%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_bulk_series_lookup' using errcode = '22023';
  end if;

  select request.*
  into request_row
  from private.bulk_vocab_series_requests as request
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

create function public.get_bulk_vocab_series_result_v1(
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_bulk_vocab_series_result_v1(
    p_idempotency_key,
    p_request_sha256
  );
$$;

create function private.create_bulk_vocab_assignments_v5(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.bulk_vocab_series_requests%rowtype;
  payload_sha256_value text;
  batch_row record;
  batch jsonb;
  batch_kind text;
  batch_student_id uuid;
  batch_dataset_id uuid;
  batch_unit_ids uuid[];
  batch_session_number integer;
  batch_session_count integer;
  batch_available_from timestamptz;
  batch_available_until timestamptz;
  created_assignment_id uuid;
  updated_assignment_count integer;
  results jsonb := '[]'::jsonb;
  distinct_student_ids uuid[];
  locked_student_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_batches is null
    or jsonb_typeof(p_batches) <> 'array'
    or jsonb_array_length(p_batches) not between 1 and 210
  then
    raise exception 'invalid_bulk_assignment_series' using errcode = '22023';
  end if;

  payload_sha256_value := encode(
    extensions.digest(convert_to(p_batches::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into private.bulk_vocab_series_requests (
    idempotency_key,
    request_sha256,
    payload_sha256,
    actor_admin_id
  )
  values (
    p_idempotency_key,
    p_request_sha256,
    payload_sha256_value,
    (select auth.uid())
  )
  on conflict (idempotency_key) do nothing;

  select request.*
  into request_row
  from private.bulk_vocab_series_requests as request
  where request.idempotency_key = p_idempotency_key
  for update;

  if request_row.actor_admin_id <> (select auth.uid())
    or request_row.request_sha256 <> p_request_sha256
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.result is not null then
    return request_row.result;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    where jsonb_typeof(input.item) <> 'object'
      or input.item ->> 'kind' not in ('regular', 'mixed')
      or nullif(input.item ->> 'student_id', '') is null
      or nullif(input.item ->> 'dataset_id', '') is null
      or jsonb_typeof(input.item -> 'unit_ids') <> 'array'
      or jsonb_array_length(input.item -> 'unit_ids') < 1
      or nullif(input.item ->> 'session_number', '') is null
      or nullif(input.item ->> 'session_count', '') is null
      or nullif(input.item ->> 'available_from', '') is null
  ) then
    raise exception 'invalid_bulk_assignment_series_batch'
      using errcode = '22023';
  end if;

  if (
    select count(distinct (item ->> 'student_id')::uuid)
    from jsonb_array_elements(p_batches) as input(item)
  ) not between 1 and 30 then
    raise exception 'invalid_bulk_assignment_series_students'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    where (item ->> 'session_number')::integer not between 1 and 7
      or (item ->> 'session_count')::integer not between 1 and 7
      or (item ->> 'session_number')::integer >
        (item ->> 'session_count')::integer
      or (
        item ->> 'kind' = 'mixed'
        and (item ->> 'session_number')::integer <> 1
      )
      or (
        nullif(item ->> 'available_until', '') is not null
        and (item ->> 'available_until')::timestamptz <=
          (item ->> 'available_from')::timestamptz
      )
  ) then
    raise exception 'invalid_bulk_assignment_series_schedule'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from (
      select
        (item ->> 'student_id')::uuid as student_id,
        (item ->> 'session_number')::integer as session_number
      from jsonb_array_elements(p_batches) as input(item)
      group by 1, 2
    ) as unique_session
  ) <> jsonb_array_length(p_batches) then
    raise exception 'duplicate_bulk_assignment_series_session'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select
        (item ->> 'student_id')::uuid as student_id,
        min((item ->> 'session_number')::integer) as minimum_session,
        max((item ->> 'session_number')::integer) as maximum_session,
        min((item ->> 'session_count')::integer) as minimum_count,
        max((item ->> 'session_count')::integer) as maximum_count,
        count(*)::integer as actual_count
      from jsonb_array_elements(p_batches) as input(item)
      group by 1
    ) as student_series
    where student_series.minimum_session <> 1
      or student_series.minimum_count <> student_series.maximum_count
      or student_series.maximum_session <> student_series.maximum_count
      or student_series.actual_count <> student_series.maximum_count
  ) then
    raise exception 'incomplete_bulk_assignment_series'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select
        (item ->> 'student_id')::uuid as student_id,
        (item ->> 'session_number')::integer as session_number,
        (item ->> 'available_from')::timestamptz as available_from,
        lag((item ->> 'available_from')::timestamptz) over (
          partition by (item ->> 'student_id')::uuid
          order by (item ->> 'session_number')::integer
        ) as previous_available_from
      from jsonb_array_elements(p_batches) as input(item)
    ) as scheduled
    where scheduled.previous_available_from is not null
      and scheduled.available_from <= scheduled.previous_available_from
  ) then
    raise exception 'non_increasing_bulk_assignment_series_schedule'
      using errcode = '22023';
  end if;

  select array_agg(student_id order by student_id)
  into distinct_student_ids
  from (
    select distinct (item ->> 'student_id')::uuid as student_id
    from jsonb_array_elements(p_batches) as input(item)
  ) as selected;

  perform student.id
  from public.students as student
  where student.id = any(distinct_student_ids)
    and student.status = 'active'
    and student.deleted_at is null
  order by student.id
  for update;

  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(distinct_student_ids)
    and student.status = 'active'
    and student.deleted_at is null;
  if locked_student_count <> cardinality(distinct_student_ids) then
    raise exception 'bulk_assignment_student_not_active'
      using errcode = '22023';
  end if;

  for batch_row in
    select input.item as batch, input.position
    from jsonb_array_elements(p_batches) with ordinality
      as input(item, position)
    order by input.position
  loop
    batch := batch_row.batch;
    batch_kind := batch ->> 'kind';
    batch_student_id := (batch ->> 'student_id')::uuid;
    batch_dataset_id := (batch ->> 'dataset_id')::uuid;
    batch_session_number := (batch ->> 'session_number')::integer;
    batch_session_count := (batch ->> 'session_count')::integer;
    batch_available_from := (batch ->> 'available_from')::timestamptz;
    batch_available_until := nullif(
      batch ->> 'available_until',
      ''
    )::timestamptz;
    select array_agg(value::uuid order by position)
    into batch_unit_ids
    from jsonb_array_elements_text(batch -> 'unit_ids') with ordinality
      as unit(value, position);

    perform private.resolve_contiguous_unit_direction_v1(
      batch_dataset_id,
      batch_unit_ids
    );

    if batch_kind = 'regular' then
      created_assignment_id := private.create_assignment_with_delivery_v7(
        batch ->> 'title',
        batch_dataset_id,
        batch_unit_ids,
        (batch ->> 'question_count')::integer,
        (batch ->> 'english_to_korean_ratio')::smallint,
        (batch ->> 'time_limit_seconds')::integer,
        (batch ->> 'passing_score')::smallint,
        (batch ->> 'question_order_mode')::public.question_order_mode,
        batch_available_until,
        array[batch_student_id],
        batch ->> 'timing_mode',
        nullif(batch ->> 'question_time_limit_seconds', '')::integer,
        batch -> 'questions'
      );
      perform private.align_assignment_unit_direction_v1(
        created_assignment_id,
        batch_dataset_id,
        batch_unit_ids
      );
    else
      created_assignment_id := private.create_mixed_review_assignment_v9(
        batch_student_id,
        batch_dataset_id,
        array(
          select value::smallint
          from jsonb_array_elements_text(batch -> 'review_levels')
            as level(value)
        ),
        coalesce(batch ->> 'review_scope', 'dataset'),
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'selected_queue_ids')
            as queue(value)
        ),
        batch ->> 'title',
        batch_unit_ids,
        (batch ->> 'english_to_korean_ratio')::smallint,
        (batch ->> 'time_limit_seconds')::integer,
        (batch ->> 'passing_score')::smallint,
        (batch ->> 'question_order_mode')::public.question_order_mode,
        batch_available_until,
        batch ->> 'timing_mode',
        nullif(batch ->> 'question_time_limit_seconds', '')::integer,
        batch -> 'questions'
      );
    end if;

    update public.assignments as assignment
    set available_from = batch_available_from
    where assignment.id = created_assignment_id
      and assignment.available_until is not distinct from batch_available_until;
    get diagnostics updated_assignment_count = row_count;
    if updated_assignment_count <> 1 then
      raise exception 'bulk_assignment_series_schedule_write_failed'
        using errcode = '21000';
    end if;

    results := results || jsonb_build_array(jsonb_build_object(
      'student_id', batch_student_id,
      'assignment_id', created_assignment_id,
      'session_number', batch_session_number
    ));
  end loop;

  if jsonb_array_length(results) <> jsonb_array_length(p_batches) then
    raise exception 'bulk_assignment_series_result_mismatch'
      using errcode = '21000';
  end if;

  update private.bulk_vocab_series_requests
  set result = results, completed_at = clock_timestamp()
  where idempotency_key = p_idempotency_key;

  insert into public.audit_events (event_type, actor_admin_id, details)
  values (
    'assignment.bulk_vocab_series_v5_created',
    (select auth.uid()),
    jsonb_build_object(
      'idempotencyKey', p_idempotency_key,
      'requestSha256', p_request_sha256,
      'studentIds', to_jsonb(distinct_student_ids),
      'assignmentCount', jsonb_array_length(results)
    )
  );

  return results;
end;
$$;

create function public.create_bulk_vocab_assignments_v5(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_bulk_vocab_assignments_v5(
    p_idempotency_key,
    p_request_sha256,
    p_batches
  );
$$;

revoke all on function private.get_bulk_vocab_series_result_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.get_bulk_vocab_series_result_v1(uuid, text)
  to authenticated, service_role;
revoke all on function public.get_bulk_vocab_series_result_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_bulk_vocab_series_result_v1(uuid, text)
  to authenticated, service_role;

revoke all on function private.create_bulk_vocab_assignments_v5(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_bulk_vocab_assignments_v5(
  uuid, text, jsonb
) to authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v5(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v5(
  uuid, text, jsonb
) to authenticated, service_role;

-- Future sessions become new only on their scheduled assignment date.
do $migration$
declare
  function_definition text;
  status_marker text := E'      and assignment.status = ''active''\n';
  availability_guard text := E'      and (assignment.available_from is null\n        or assignment.available_from <= clock_timestamp())\n';
begin
  select replace(
    pg_get_functiondef(
      'public.claim_student_notifications_v1(uuid)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;
  if position(status_marker in function_definition) = 0
    or position(availability_guard in function_definition) > 0
  then
    raise exception 'student_notification_claim_shape_changed';
  end if;
  function_definition := replace(
    function_definition,
    status_marker,
    status_marker || availability_guard
  );
  execute function_definition;
end;
$migration$;

commit;
