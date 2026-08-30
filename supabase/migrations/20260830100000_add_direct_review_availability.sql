begin;

alter table private.current_wrong_review_assignment_requests
  add column schedule_sha256 text;

alter table private.current_wrong_review_assignment_requests
  add constraint current_wrong_review_assignment_schedule_sha256_check
  check (
    schedule_sha256 is null
    or schedule_sha256 ~ '^[0-9a-f]{64}$'
  );

create function public.create_current_wrong_review_assignment_v2(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_source_question_ids uuid[],
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_title text,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_from timestamptz,
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
  request_row private.current_wrong_review_assignment_requests%rowtype;
  schedule_sha256_value text;
  created_assignment_id uuid;
  updated_assignment_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or p_dataset_id is null
    or p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or (p_available_from is not null and not pg_catalog.isfinite(p_available_from))
    or (p_available_until is not null and not pg_catalog.isfinite(p_available_until))
    or (
      p_available_from is not null
      and p_available_until is not null
      and p_available_until <= p_available_from
    )
  then
    raise exception 'invalid_current_wrong_review_schedule'
      using errcode = '22023';
  end if;

  schedule_sha256_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'available_from_epoch_microseconds', case
            when p_available_from is null then null
            else round(extract(epoch from p_available_from) * 1000000)::bigint
          end,
          'available_until_epoch_microseconds', case
            when p_available_until is null then null
            else round(extract(epoch from p_available_until) * 1000000)::bigint
          end
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into private.current_wrong_review_assignment_requests (
    idempotency_key,
    request_sha256,
    student_id,
    dataset_id,
    created_by,
    schedule_sha256
  ) values (
    p_idempotency_key,
    p_request_sha256,
    p_student_id,
    p_dataset_id,
    (select auth.uid()),
    schedule_sha256_value
  ) on conflict (idempotency_key) do nothing;

  select request.*
  into request_row
  from private.current_wrong_review_assignment_requests as request
  where request.idempotency_key = p_idempotency_key
  for update;

  if request_row.idempotency_key is null
    or request_row.request_sha256 <> p_request_sha256
    or request_row.student_id <> p_student_id
    or request_row.dataset_id <> p_dataset_id
    or request_row.created_by <> (select auth.uid())
    or request_row.schedule_sha256 is distinct from schedule_sha256_value
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.assignment_id is not null then
    return request_row.assignment_id;
  end if;

  created_assignment_id := public.create_current_wrong_review_assignment_v1(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_source_question_ids,
    p_idempotency_key,
    p_request_sha256,
    p_title,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_retry_enabled,
    p_retry_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );

  update public.assignments as assignment
  set available_from = p_available_from
  where assignment.id = created_assignment_id
    and assignment.deleted_at is null
    and assignment.available_until is not distinct from p_available_until;
  get diagnostics updated_assignment_count = row_count;
  if updated_assignment_count <> 1 then
    raise exception 'current_wrong_review_schedule_write_failed'
      using errcode = '21000';
  end if;

  return created_assignment_id;
end;
$$;

revoke all on function public.create_current_wrong_review_assignment_v2(
  uuid, uuid, smallint[], uuid[], uuid, text, text, smallint, integer,
  smallint, boolean, smallint, public.question_order_mode, timestamptz,
  timestamptz, text, integer, jsonb
) from public, anon;
grant execute on function public.create_current_wrong_review_assignment_v2(
  uuid, uuid, smallint[], uuid[], uuid, text, text, smallint, integer,
  smallint, boolean, smallint, public.question_order_mode, timestamptz,
  timestamptz, text, integer, jsonb
) to authenticated;

notify pgrst, 'reload schema';

commit;
