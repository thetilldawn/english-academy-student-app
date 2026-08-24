begin;

create table private.current_wrong_review_assignment_requests (
  idempotency_key uuid primary key,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  student_id uuid not null references public.students(id) on delete restrict,
  dataset_id uuid not null references public.vocab_datasets(id) on delete restrict,
  assignment_id uuid references public.assignments(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (assignment_id is null and completed_at is null)
    or (assignment_id is not null and completed_at is not null)
  )
);

revoke all on table private.current_wrong_review_assignment_requests
  from public, anon, authenticated, service_role;

create function public.get_current_wrong_review_assignment_result_v1(
  p_student_id uuid,
  p_dataset_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  request_row private.current_wrong_review_assignment_requests%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or p_dataset_id is null
    or p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_current_wrong_review_lookup'
      using errcode = '22023';
  end if;

  select request.*
  into request_row
  from private.current_wrong_review_assignment_requests as request
  where request.idempotency_key = p_idempotency_key;
  if request_row.idempotency_key is null then return null; end if;
  if request_row.request_sha256 <> p_request_sha256
    or request_row.student_id <> p_student_id
    or request_row.dataset_id <> p_dataset_id
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  return request_row.assignment_id;
end;
$$;

create function public.create_current_wrong_review_assignment_v1(
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
  current_source_question_ids uuid[];
  queued_ids uuid[];
  selected_queue_ids uuid[];
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_review_levels is null
    or cardinality(p_review_levels) not between 1 and 2
    or cardinality(p_review_levels) <> (
      select count(distinct level)
      from unnest(p_review_levels) as input(level)
      where level in (1, 2)
    )
    or p_source_question_ids is null
    or cardinality(p_source_question_ids) not between 1 and 400
    or cardinality(p_source_question_ids) <> (
      select count(distinct question_id)
      from unnest(p_source_question_ids) as input(question_id)
      where question_id is not null
    )
    or p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <>
      cardinality(p_source_question_ids)
  then
    raise exception 'invalid_current_wrong_review_request'
      using errcode = '22023';
  end if;

  insert into private.current_wrong_review_assignment_requests (
    idempotency_key,
    request_sha256,
    student_id,
    dataset_id,
    created_by
  ) values (
    p_idempotency_key,
    p_request_sha256,
    p_student_id,
    p_dataset_id,
    (select auth.uid())
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
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.assignment_id is not null then
    return request_row.assignment_id;
  end if;

  perform student.id
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
    and student.deleted_at is null
  for update;
  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  select array_agg(
    candidate.source_question_id
    order by
      candidate.reason_level desc,
      candidate.last_wrong_at desc nulls last,
      candidate.source_question_id
  )
  into current_source_question_ids
  from (
    select current_candidate.*
    from private.list_student_direct_review_candidates_v1(
      p_student_id,
      p_dataset_id
    ) as current_candidate
    where current_candidate.reason_level = any(p_review_levels)
    order by
      current_candidate.reason_level desc,
      current_candidate.last_wrong_at desc nulls last,
      current_candidate.source_question_id
    limit 400
  ) as candidate;

  if current_source_question_ids is distinct from p_source_question_ids then
    raise exception 'current_wrong_review_snapshot_changed'
      using errcode = '40001';
  end if;

  queued_ids := private.queue_student_vocab_review_words(
    p_student_id,
    p_source_question_ids
  );
  if cardinality(queued_ids) <> cardinality(p_source_question_ids) then
    raise exception 'current_wrong_review_queue_mismatch'
      using errcode = '40001';
  end if;

  select array_agg(queue.id order by selected.position)
  into selected_queue_ids
  from unnest(p_source_question_ids) with ordinality
    as selected(source_question_id, position)
  join public.quiz_questions as source_question
    on source_question.id = selected.source_question_id
  join public.vocab_entries as source_entry
    on source_entry.id = source_question.vocab_entry_id
   and source_entry.dataset_id = p_dataset_id
  join public.student_vocab_wrong_events as source_wrong
    on source_wrong.quiz_question_id = source_question.id
   and source_wrong.student_id = p_student_id
   and source_wrong.wrong_stage = 'initial'
  join lateral (
    select candidate_queue.id
    from public.student_vocab_review_queue as candidate_queue
    join public.vocab_entries as queue_entry
      on queue_entry.id = candidate_queue.vocab_entry_id
     and queue_entry.dataset_id = candidate_queue.dataset_id
    where candidate_queue.student_id = p_student_id
      and candidate_queue.dataset_id = p_dataset_id
      and candidate_queue.status = 'pending'
      and candidate_queue.reserved_review_draft_id is null
      and private.vocab_identity_matches_v1(
        source_entry.dataset_id,
        source_entry.id,
        source_wrong.canonical_dictionary_id_snapshot,
        source_wrong.canonical_lexeme_id_snapshot,
        source_entry.headword_normalized,
        candidate_queue.dataset_id,
        candidate_queue.vocab_entry_id,
        candidate_queue.canonical_dictionary_id_snapshot,
        candidate_queue.canonical_lexeme_id_snapshot,
        queue_entry.headword_normalized
      )
    order by
      (candidate_queue.vocab_entry_id = source_entry.id) desc,
      candidate_queue.reason_level desc,
      candidate_queue.queued_at,
      candidate_queue.id
    limit 1
  ) as queue on true;

  if selected_queue_ids is null
    or cardinality(selected_queue_ids) <>
      cardinality(p_source_question_ids)
    or cardinality(selected_queue_ids) <> (
      select count(distinct queue_id)
      from unnest(selected_queue_ids) as input(queue_id)
    )
  then
    raise exception 'current_wrong_review_queue_order_mismatch'
      using errcode = '40001';
  end if;

  created_assignment_id := private.create_exact_review_assignment_v5(
    p_student_id,
    p_dataset_id,
    selected_queue_ids,
    p_title,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
  perform private.configure_assignment_retry_v1(
    created_assignment_id,
    p_retry_enabled,
    p_retry_passing_score
  );

  update private.current_wrong_review_assignment_requests as request
  set
    assignment_id = created_assignment_id,
    completed_at = clock_timestamp()
  where request.idempotency_key = p_idempotency_key
    and request.assignment_id is null;
  if not found then
    raise exception 'current_wrong_review_request_finalize_mismatch'
      using errcode = '21000';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  ) values (
    'assignment.current_wrong_review_v1_created',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'idempotencyKey', p_idempotency_key,
      'requestSha256', p_request_sha256,
      'sourceQuestionIds', to_jsonb(p_source_question_ids),
      'queueIds', to_jsonb(selected_queue_ids)
    )
  );

  return created_assignment_id;
end;
$$;

revoke all on function public.create_current_wrong_review_assignment_v1(
  uuid, uuid, smallint[], uuid[], uuid, text, text, smallint, integer,
  smallint, boolean, smallint, public.question_order_mode, timestamptz,
  text, integer, jsonb
) from public, anon;
revoke all on function public.get_current_wrong_review_assignment_result_v1(
  uuid, uuid, uuid, text
) from public, anon;
grant execute on function public.get_current_wrong_review_assignment_result_v1(
  uuid, uuid, uuid, text
) to authenticated;
grant execute on function public.create_current_wrong_review_assignment_v1(
  uuid, uuid, smallint[], uuid[], uuid, text, text, smallint, integer,
  smallint, boolean, smallint, public.question_order_mode, timestamptz,
  text, integer, jsonb
) to authenticated;

notify pgrst, 'reload schema';

commit;
