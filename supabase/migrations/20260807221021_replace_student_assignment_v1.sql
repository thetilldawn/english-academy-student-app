begin;

-- A replacement is a recipient-scoped operation. The source assignment may be
-- shared by other students, so the immutable source question bank is never
-- updated. This private ledger makes retries and concurrent submissions return
-- one replacement assignment.
create table private.assignment_replacement_requests (
  idempotency_key uuid primary key,
  request_sha256 text not null
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  actor_admin_id uuid not null references auth.users(id) on delete restrict,
  source_assignment_id uuid not null
    references public.assignments(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  replacement_kind text not null
    check (replacement_kind in ('regular', 'mixed')),
  replacement_assignment_id uuid unique
    references public.assignments(id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint assignment_replacement_requests_result_check check (
    (
      replacement_assignment_id is null
      and result is null
      and completed_at is null
    )
    or (
      replacement_assignment_id is not null
      and result is not null
      and completed_at is not null
    )
  )
);

create index assignment_replacement_requests_source_student_idx
  on private.assignment_replacement_requests (
    source_assignment_id,
    student_id,
    created_at desc
  );

revoke all on table private.assignment_replacement_requests
  from public, anon, authenticated, service_role;

-- This lookup lets a lost HTTP response be retried before the server rebuilds
-- a randomized question plan. It never exposes another admin request: active
-- admin authorization and the complete source/student/hash tuple are required.
create function private.get_student_assignment_replacement_result_v1(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.assignment_replacement_requests%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_source_assignment_id is null
    or p_student_id is null
    or p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_assignment_replacement_lookup'
      using errcode = '22023';
  end if;

  select request.*
  into request_row
  from private.assignment_replacement_requests as request
  where request.idempotency_key = p_idempotency_key;

  if not found then
    return null;
  end if;
  if request_row.source_assignment_id <> p_source_assignment_id
    or request_row.student_id <> p_student_id
    or request_row.request_sha256 <> p_request_sha256
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  if request_row.result is null then
    return null;
  end if;
  return request_row.result || jsonb_build_object('idempotent', true);
end;
$$;

create function public.get_student_assignment_replacement_result_v1(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_student_assignment_replacement_result_v1(
    p_source_assignment_id,
    p_student_id,
    p_idempotency_key,
    p_request_sha256
  );
$$;

-- The physical order is source-recipient cancellation followed by creation.
-- Both occur in this one statement, so any creation error restores the source
-- link and its review targets automatically.
create function private.replace_student_assignment_v1(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.assignment_replacement_requests%rowtype;
  student_status public.student_status;
  student_deleted_at timestamptz;
  source_status public.assignment_status;
  source_deleted_at timestamptz;
  source_available_until timestamptz;
  source_title text;
  source_dataset_id uuid;
  source_question_count integer;
  source_ratio smallint;
  source_time_limit integer;
  source_timing_mode text;
  source_question_time_limit integer;
  source_passing_score smallint;
  source_order_mode public.question_order_mode;
  source_purpose text;
  link_missed_at timestamptz;
  link_cancelled_at timestamptz;
  created_replacement_assignment_id uuid;
  replacement_purpose text;
  result_value jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_source_assignment_id is null
    or p_student_id is null
    or p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_replacement_kind not in ('regular', 'mixed')
    or p_title is null
    or char_length(p_title) not between 1 and 160
    or p_dataset_id is null
    or p_primary_unit_ids is null
    or cardinality(p_primary_unit_ids) not between 1 and 500
    or cardinality(p_primary_unit_ids) <> (
      select count(distinct unit_id)
      from unnest(p_primary_unit_ids) as input(unit_id)
      where unit_id is not null
    )
    or p_question_count is null
    or p_question_count not between 4 and 500
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <> p_question_count
    or p_available_until is not null
      and p_available_until <= clock_timestamp()
    or (
      p_replacement_kind = 'regular'
      and (
        coalesce(cardinality(p_review_levels), 0) <> 0
        or coalesce(cardinality(p_selected_queue_ids), 0) <> 0
      )
    )
    or (
      p_replacement_kind = 'mixed'
      and (
        p_review_levels is null
        or cardinality(p_review_levels) not between 1 and 2
        or p_selected_queue_ids is null
        or cardinality(p_selected_queue_ids) not between 1 and 500
      )
    )
  then
    raise exception 'invalid_assignment_replacement_input'
      using errcode = '22023';
  end if;

  -- Every attempt/cancel/missed path uses this student-first lock order.
  select student.status, student.deleted_at
  into student_status, student_deleted_at
  from public.students as student
  where student.id = p_student_id
  for update;
  if not found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;
  if student_deleted_at is not null then
    raise exception 'student_deleted' using errcode = '22023';
  end if;
  if student_status <> 'active' then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  insert into private.assignment_replacement_requests (
    idempotency_key,
    request_sha256,
    actor_admin_id,
    source_assignment_id,
    student_id,
    replacement_kind
  )
  values (
    p_idempotency_key,
    p_request_sha256,
    (select auth.uid()),
    p_source_assignment_id,
    p_student_id,
    p_replacement_kind
  )
  on conflict (idempotency_key) do nothing;

  select request.*
  into request_row
  from private.assignment_replacement_requests as request
  where request.idempotency_key = p_idempotency_key
  for update;

  if request_row.source_assignment_id <> p_source_assignment_id
    or request_row.student_id <> p_student_id
    or request_row.request_sha256 <> p_request_sha256
    or request_row.replacement_kind <> p_replacement_kind
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.result is not null then
    return request_row.result || jsonb_build_object('idempotent', true);
  end if;

  select
    assignment.status,
    assignment.deleted_at,
    assignment.available_until,
    assignment.title,
    assignment.dataset_id,
    assignment.question_count,
    assignment.english_to_korean_ratio,
    assignment.time_limit_seconds,
    assignment.timing_mode,
    assignment.question_time_limit_seconds,
    assignment.passing_score,
    assignment.question_order_mode,
    assignment.assignment_purpose,
    link.missed_at,
    link.cancelled_at
  into
    source_status,
    source_deleted_at,
    source_available_until,
    source_title,
    source_dataset_id,
    source_question_count,
    source_ratio,
    source_time_limit,
    source_timing_mode,
    source_question_time_limit,
    source_passing_score,
    source_order_mode,
    source_purpose,
    link_missed_at,
    link_cancelled_at
  from public.assignment_students as link
  join public.assignments as assignment
    on assignment.id = link.assignment_id
  where link.assignment_id = p_source_assignment_id
    and link.student_id = p_student_id
  for update of assignment, link;

  if not found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;
  if source_deleted_at is not null then
    raise exception 'assignment_deleted' using errcode = '22023';
  end if;
  if source_status <> 'active' then
    raise exception 'assignment_not_active' using errcode = '22023';
  end if;
  if link_cancelled_at is not null then
    raise exception 'assignment_already_cancelled' using errcode = '22023';
  end if;
  if link_missed_at is not null then
    raise exception 'assignment_already_missed' using errcode = '22023';
  end if;
  if source_available_until is not null
    and source_available_until <= clock_timestamp()
  then
    raise exception 'assignment_unavailable' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.assignment_id = p_source_assignment_id
      and attempt.student_id = p_student_id
  ) then
    raise exception 'assignment_already_started' using errcode = '22023';
  end if;

  perform private.cancel_student_assignment_v1(
    p_source_assignment_id,
    p_student_id,
    '배정 수정으로 교체'
  );

  if p_replacement_kind = 'regular' then
    created_replacement_assignment_id := private.create_assignment_with_delivery_v5(
      p_title,
      p_dataset_id,
      p_primary_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      array[p_student_id],
      p_timing_mode,
      p_question_time_limit_seconds,
      p_questions
    );
  else
    created_replacement_assignment_id := private.create_mixed_review_assignment_v6(
      p_student_id,
      p_dataset_id,
      p_review_levels,
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
  end if;

  select assignment.assignment_purpose
  into replacement_purpose
  from public.assignments as assignment
  where assignment.id = created_replacement_assignment_id;

  if created_replacement_assignment_id is null
    or replacement_purpose is null
    or (
      select count(*)
      from public.assignment_students as link
      where link.assignment_id = created_replacement_assignment_id
        and link.student_id = p_student_id
        and link.cancelled_at is null
        and link.missed_at is null
    ) <> 1
    or (
      select count(*)
      from public.assignment_students as link
      where link.assignment_id = created_replacement_assignment_id
    ) <> 1
  then
    raise exception 'assignment_replacement_persistence_mismatch'
      using errcode = '21000';
  end if;

  result_value := jsonb_build_object(
    'status', 'replaced',
    'sourceAssignmentId', p_source_assignment_id,
    'replacementAssignmentId', created_replacement_assignment_id,
    'studentId', p_student_id,
    'replacementPurpose', replacement_purpose,
    'idempotent', false
  );

  update private.assignment_replacement_requests
  set
    replacement_assignment_id = created_replacement_assignment_id,
    result = result_value,
    completed_at = clock_timestamp()
  where idempotency_key = p_idempotency_key;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.student.replaced',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'sourceAssignmentId', p_source_assignment_id,
      'replacementAssignmentId', created_replacement_assignment_id,
      'idempotencyKey', p_idempotency_key,
      'requestSha256', p_request_sha256,
      'before', jsonb_build_object(
        'title', source_title,
        'datasetId', source_dataset_id,
        'questionCount', source_question_count,
        'englishToKoreanRatio', source_ratio,
        'timeLimitSeconds', source_time_limit,
        'timingMode', source_timing_mode,
        'questionTimeLimitSeconds', source_question_time_limit,
        'passingScore', source_passing_score,
        'questionOrderMode', source_order_mode,
        'availableUntil', source_available_until,
        'purpose', source_purpose
      ),
      'after', jsonb_build_object(
        'title', p_title,
        'datasetId', p_dataset_id,
        'primaryUnitIds', to_jsonb(p_primary_unit_ids),
        'questionCount', p_question_count,
        'englishToKoreanRatio', p_english_to_korean_ratio,
        'timeLimitSeconds', p_time_limit_seconds,
        'timingMode', p_timing_mode,
        'questionTimeLimitSeconds', p_question_time_limit_seconds,
        'passingScore', p_passing_score,
        'questionOrderMode', p_question_order_mode,
        'availableUntil', p_available_until,
        'purpose', replacement_purpose,
        'reviewLevels', to_jsonb(p_review_levels)
      )
    )
  );

  return result_value;
end;
$$;

create function public.replace_student_assignment_v1(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
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
  select private.replace_student_assignment_v1(
    p_source_assignment_id,
    p_student_id,
    p_idempotency_key,
    p_request_sha256,
    p_replacement_kind,
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

revoke all on function private.get_student_assignment_replacement_result_v1(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function private.get_student_assignment_replacement_result_v1(
  uuid, uuid, uuid, text
) to authenticated, service_role;
revoke all on function public.get_student_assignment_replacement_result_v1(
  uuid, uuid, uuid, text
) from public, anon;
grant execute on function public.get_student_assignment_replacement_result_v1(
  uuid, uuid, uuid, text
) to authenticated, service_role;

revoke all on function private.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, public.question_order_mode, timestamptz, text,
  integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, public.question_order_mode, timestamptz, text,
  integer, smallint[], uuid[], jsonb
) to authenticated, service_role;
revoke all on function public.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, public.question_order_mode, timestamptz, text,
  integer, smallint[], uuid[], jsonb
) from public, anon;
grant execute on function public.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, public.question_order_mode, timestamptz, text,
  integer, smallint[], uuid[], jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
