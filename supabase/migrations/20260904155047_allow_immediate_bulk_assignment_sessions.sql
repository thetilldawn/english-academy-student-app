begin;

-- Preserve the proven atomic v10 writer while versioning the audit event and
-- public entry point for undated multi-session regular assignments.
do $migration$
declare
  function_definition text;
begin
  select replace(
    pg_get_functiondef(
      'private.create_bulk_vocab_assignments_v10(uuid,text,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(
      'non_increasing_bulk_assignment_series_schedule'
      in function_definition
    ) = 0
    or position(
      'private.create_assignment_with_delivery_v7('
      in function_definition
    ) = 0
    or position(
      'assignment.bulk_vocab_series_v10_created'
      in function_definition
    ) = 0
  then
    raise exception 'bulk_vocab_series_v10_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_bulk_vocab_assignments_v10(',
    'private.create_bulk_vocab_assignments_v11('
  );
  function_definition := replace(
    function_definition,
    'assignment.bulk_vocab_series_v10_created',
    'assignment.bulk_vocab_series_v11_created'
  );

  if position(
      'private.create_bulk_vocab_assignments_v10('
      in function_definition
    ) > 0
    or position(
      'private.create_bulk_vocab_assignments_v11('
      in function_definition
    ) = 0
    or position(
      'assignment.bulk_vocab_series_v11_created'
      in function_definition
    ) = 0
  then
    raise exception 'bulk_vocab_series_v11_rewrite_failed';
  end if;

  execute function_definition;
end;
$migration$;

-- A regular series may now be either fully scheduled or fully immediate.
-- Immediate sessions are all created in the same atomic request; no
-- completion queue or invented calendar date is used.
create function public.create_bulk_vocab_assignments_v11(
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
  total_question_count bigint;
  payload_sha256_value text;
  stored_payload_sha256 text;
  result_value jsonb;
  result_item jsonb;
  batch_item jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_batches is null or jsonb_typeof(p_batches) is distinct from 'array' then
    raise exception 'invalid_bulk_assignment_batches' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    where (
        (
          jsonb_typeof(input.item -> 'available_from') = 'string'
          and btrim(input.item ->> 'available_from') = ''
        )
        or (
          jsonb_typeof(input.item -> 'available_until') = 'string'
          and btrim(input.item ->> 'available_until') = ''
        )
      )
      or (
        nullif(input.item ->> 'available_from', '') is null
        and nullif(input.item ->> 'available_until', '') is not null
      )
      or (
        nullif(input.item ->> 'available_from', '') is not null
        and (
          nullif(input.item ->> 'available_until', '') is null
          or not pg_catalog.isfinite(
            nullif(btrim(input.item ->> 'available_from'), '')::timestamptz
          )
          or not pg_catalog.isfinite(
            nullif(btrim(input.item ->> 'available_until'), '')::timestamptz
          )
          or nullif(btrim(input.item ->> 'available_until'), '')::timestamptz <=
            nullif(btrim(input.item ->> 'available_from'), '')::timestamptz
        )
      )
      or (
        nullif(input.item ->> 'available_from', '') is null
        and input.item ->> 'kind' is distinct from 'regular'
        and (
          nullif(input.item ->> 'session_number', '')::integer <> 1
          or nullif(input.item ->> 'session_count', '')::integer <> 1
        )
      )
  ) then
    raise exception 'invalid_bulk_assignment_series_schedule'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select
        input.item ->> 'student_id' as student_id,
        bool_or(nullif(input.item ->> 'available_from', '') is null)
          as has_immediate,
        bool_or(nullif(input.item ->> 'available_from', '') is not null)
          as has_scheduled
      from jsonb_array_elements(p_batches) as input(item)
      group by input.item ->> 'student_id'
    ) as schedule_modes
    where schedule_modes.has_immediate and schedule_modes.has_scheduled
  ) then
    raise exception 'mixed_bulk_assignment_series_schedule'
      using errcode = '22023';
  end if;

  select coalesce(sum(
    greatest(
      case
        when jsonb_typeof(item -> 'question_count') = 'number'
          and (item ->> 'question_count') ~ '^[0-9]+$'
        then (item ->> 'question_count')::bigint
        else 10001
      end,
      case
        when jsonb_typeof(item -> 'questions') = 'array'
        then jsonb_array_length(item -> 'questions')::bigint
        else 10001
      end
    )
  ), 0)
  into total_question_count
  from jsonb_array_elements(p_batches) as batch(item);

  if total_question_count > 10000 then
    raise exception 'bulk_question_count_exceeded' using errcode = '22023';
  end if;

  payload_sha256_value := encode(
    extensions.digest(convert_to(p_batches::text, 'UTF8'), 'sha256'),
    'hex'
  );

  result_value := private.create_bulk_vocab_assignments_v11(
    p_idempotency_key,
    p_request_sha256,
    p_batches
  );

  select request.payload_sha256
  into stored_payload_sha256
  from private.bulk_vocab_series_requests as request
  where request.idempotency_key = p_idempotency_key;
  if stored_payload_sha256 is distinct from payload_sha256_value then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  for result_item in
    select value
    from jsonb_array_elements(result_value)
  loop
    select batch.value
    into batch_item
    from jsonb_array_elements(p_batches) as batch(value)
    where batch.value ->> 'student_id' = result_item ->> 'student_id'
      and batch.value ->> 'session_number' =
        result_item ->> 'session_number';

    if batch_item is null
      or jsonb_typeof(batch_item -> 'retry_enabled') <> 'boolean'
      or not (batch_item ? 'retry_passing_score')
    then
      raise exception 'invalid_assignment_retry_settings'
        using errcode = '22023';
    end if;

    perform private.configure_assignment_retry_v1(
      (result_item ->> 'assignment_id')::uuid,
      (batch_item ->> 'retry_enabled')::boolean,
      nullif(batch_item ->> 'retry_passing_score', '')::smallint
    );
  end loop;

  return result_value;
end;
$$;

revoke all on function private.create_bulk_vocab_assignments_v11(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v10(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v11(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v11(
  uuid, text, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
