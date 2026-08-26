begin;

-- One row per bounded maintenance job. This is a current health snapshot,
-- not an append-only success log.
create table private.student_app_maintenance_state (
  job_name text primary key
    check (
      job_name in (
        'english-academy-finalize-stale-attempts',
        'english-academy-expire-review-drafts',
        'english-academy-materialize-ready-vocab-queues'
      )
    ),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_clean_at timestamptz,
  processed_count integer not null default 0
    check (processed_count >= 0),
  failed_count integer not null default 0
    check (failed_count >= 0),
  attention_count integer not null default 0
    check (attention_count >= 0),
  pending_count integer not null default 0
    check (pending_count >= 0),
  pending_count_is_lower_bound boolean not null default false,
  oldest_due_at timestamptz,
  consecutive_failed_runs integer not null default 0
    check (consecutive_failed_runs >= 0),
  last_error_code text,
  updated_at timestamptz not null default transaction_timestamp(),
  constraint student_app_maintenance_state_time_check check (
    last_completed_at is null
    or (
      last_started_at is not null
      and last_completed_at >= last_started_at
    )
  )
);

-- Failed targets leave the hot candidate set for a bounded backoff. After
-- repeated failures they remain as an explicit operator-attention record and
-- are not retried indefinitely.
create table private.student_app_maintenance_retry_state (
  job_name text not null
    check (
      job_name in (
        'english-academy-finalize-stale-attempts',
        'english-academy-expire-review-drafts',
        'english-academy-materialize-ready-vocab-queues'
      )
    ),
  target_kind text not null
    check (target_kind in ('quiz_attempt', 'review_draft', 'vocab_series_item')),
  target_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  consecutive_failures integer not null
    check (consecutive_failures between 1 and 5),
  next_retry_at timestamptz,
  requires_attention boolean not null default false,
  last_error_code text not null,
  last_failed_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (job_name, target_kind, target_id),
  constraint student_app_maintenance_retry_target_check check (
    (job_name = 'english-academy-finalize-stale-attempts'
      and target_kind = 'quiz_attempt')
    or (job_name = 'english-academy-expire-review-drafts'
      and target_kind = 'review_draft')
    or (job_name = 'english-academy-materialize-ready-vocab-queues'
      and target_kind = 'vocab_series_item')
  ),
  constraint student_app_maintenance_retry_state_check check (
    (requires_attention and next_retry_at is null)
    or (not requires_attention and next_retry_at is not null)
  )
);

create index student_app_maintenance_retry_candidate_idx
on private.student_app_maintenance_retry_state (
  job_name,
  student_id,
  requires_attention,
  next_retry_at,
  target_kind,
  target_id
);

revoke all on table private.student_app_maintenance_state
  from public, anon, authenticated, service_role;
revoke all on table private.student_app_maintenance_retry_state
  from public, anon, authenticated, service_role;

create function private.classify_student_app_maintenance_error_v1(
  p_sqlstate text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_sqlstate in ('40001', '40P01', '55P03') then 'concurrency'
    when p_sqlstate in ('22023', '22007', '23502') then 'invalid_data'
    when p_sqlstate in ('23503', '23505') then 'data_conflict'
    when p_sqlstate = 'P0002' then 'missing_data'
    when p_sqlstate = '42501' then 'permission'
    else 'database_error'
  end;
$$;

create function private.record_student_app_maintenance_failure_v1(
  p_job_name text,
  p_target_kind text,
  p_target_id uuid,
  p_student_id uuid,
  p_error_code text,
  p_failed_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_failure_count integer;
  next_failure_count integer;
  requires_attention_value boolean;
  next_retry_at_value timestamptz;
begin
  if p_job_name not in (
    'english-academy-finalize-stale-attempts',
    'english-academy-expire-review-drafts',
    'english-academy-materialize-ready-vocab-queues'
  )
    or p_target_kind not in (
      'quiz_attempt',
      'review_draft',
      'vocab_series_item'
    )
    or not (
      (p_job_name = 'english-academy-finalize-stale-attempts'
        and p_target_kind = 'quiz_attempt')
      or (p_job_name = 'english-academy-expire-review-drafts'
        and p_target_kind = 'review_draft')
      or (p_job_name = 'english-academy-materialize-ready-vocab-queues'
        and p_target_kind = 'vocab_series_item')
    )
    or p_target_id is null
    or p_student_id is null
    or p_error_code not in (
      'concurrency',
      'invalid_data',
      'data_conflict',
      'missing_data',
      'permission',
      'database_error',
      'retryable_materialization'
    )
    or p_failed_at is null
  then
    raise exception 'invalid_student_app_maintenance_failure'
      using errcode = '22023';
  end if;

  select retry.consecutive_failures
  into previous_failure_count
  from private.student_app_maintenance_retry_state as retry
  where retry.job_name = p_job_name
    and retry.target_kind = p_target_kind
    and retry.target_id = p_target_id
  for update;

  next_failure_count := least(coalesce(previous_failure_count, 0) + 1, 5);
  requires_attention_value := next_failure_count >= 5;
  next_retry_at_value := case
    when requires_attention_value then null
    when next_failure_count = 1 then p_failed_at + interval '2 minutes'
    when next_failure_count = 2 then p_failed_at + interval '10 minutes'
    when next_failure_count = 3 then p_failed_at + interval '30 minutes'
    else p_failed_at + interval '2 hours'
  end;

  insert into private.student_app_maintenance_retry_state (
    job_name,
    target_kind,
    target_id,
    student_id,
    consecutive_failures,
    next_retry_at,
    requires_attention,
    last_error_code,
    last_failed_at,
    updated_at
  ) values (
    p_job_name,
    p_target_kind,
    p_target_id,
    p_student_id,
    next_failure_count,
    next_retry_at_value,
    requires_attention_value,
    p_error_code,
    p_failed_at,
    p_failed_at
  )
  on conflict (job_name, target_kind, target_id)
  do update set
    student_id = excluded.student_id,
    consecutive_failures = excluded.consecutive_failures,
    next_retry_at = excluded.next_retry_at,
    requires_attention = excluded.requires_attention,
    last_error_code = excluded.last_error_code,
    last_failed_at = excluded.last_failed_at,
    updated_at = excluded.updated_at;
end;
$$;

create function private.clear_student_app_maintenance_failure_v1(
  p_job_name text,
  p_target_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from private.student_app_maintenance_retry_state as retry
  where retry.job_name = p_job_name
    and retry.target_id = p_target_id;
$$;

-- The maintenance worker supplies one transaction timestamp. Normal quiz
-- commands continue to use the existing finalizer.
create function private.finalize_expired_quiz_attempt_at_v2(
  p_student_id uuid,
  p_attempt_id uuid,
  p_evaluation_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  question_total integer;
  initial_correct integer;
  retry_correct integer;
  unresolved_wrong integer;
  initial_score_value numeric(5,2);
  final_score_value numeric(5,2);
  elapsed_seconds_value integer;
begin
  if p_student_id is null
    or p_attempt_id is null
    or p_evaluation_at is null
  then
    raise exception 'invalid_expired_attempt_evaluation'
      using errcode = '22023';
  end if;

  select *
  into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if attempt_row.status = 'completed' then
    return jsonb_build_object('completed', true, 'expired', false);
  end if;
  if attempt_row.status = 'expired' then
    return jsonb_build_object('completed', true, 'expired', true);
  end if;
  if attempt_row.phase = 'review' then
    raise exception 'attempt_review_not_timed' using errcode = '22023';
  end if;
  if attempt_row.deadline_at > p_evaluation_at then
    raise exception 'attempt_not_expired' using errcode = '22023';
  end if;

  update public.quiz_questions
  set initial_is_correct = false,
      initial_answered_at = attempt_row.deadline_at,
      initial_timed_out = true
  where attempt_id = p_attempt_id
    and initial_choice_index is null
    and initial_is_correct is null;

  if attempt_row.phase = 'retry' then
    update public.quiz_questions
    set retry_is_correct = false,
        retry_answered_at = attempt_row.deadline_at,
        retry_timed_out = true
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and retry_choice_index is null
      and retry_is_correct is null;
  end if;

  select
    count(*),
    count(*) filter (where initial_is_correct is true),
    count(*) filter (
      where initial_is_correct is false
        and retry_is_correct is true
    ),
    count(*) filter (
      where coalesce(initial_is_correct, false) is false
        and coalesce(retry_is_correct, false) is false
    )
  into
    question_total,
    initial_correct,
    retry_correct,
    unresolved_wrong
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  if question_total = 0 then
    raise exception 'attempt_has_no_questions' using errcode = '22023';
  end if;

  initial_score_value := round(
    (initial_correct::numeric / question_total) * 100,
    2
  );
  final_score_value := round(
    ((initial_correct + retry_correct)::numeric / question_total) * 100,
    2
  );
  elapsed_seconds_value := case
    when attempt_row.phase = 'retry'
      and attempt_row.initial_completed_at is not null
      and attempt_row.retry_started_at is not null
    then
      greatest(
        0,
        floor(
          extract(
            epoch from (
              attempt_row.initial_completed_at - attempt_row.started_at
            )
          )
        )::integer
      )
      + greatest(
        0,
        floor(
          extract(
            epoch from (
              attempt_row.deadline_at - attempt_row.retry_started_at
            )
          )
        )::integer
      )
    else greatest(
      0,
      floor(
        extract(epoch from (attempt_row.deadline_at - attempt_row.started_at))
      )::integer
    )
  end;

  update public.quiz_attempts
  set status = 'expired',
      phase = 'completed',
      completed_at = p_evaluation_at,
      initial_correct_count = initial_correct,
      retry_correct_count = retry_correct,
      unresolved_wrong_count = unresolved_wrong,
      initial_score = initial_score_value,
      final_score = final_score_value,
      passed = false,
      elapsed_seconds = elapsed_seconds_value
  where id = p_attempt_id;

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    unresolved_wrong_count,
    last_wrong_at,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  select
    p_student_id,
    vocab_entry_id,
    1,
    attempt_row.deadline_at,
    null,
    p_attempt_id,
    attempt_row.deadline_at
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and initial_is_correct is false
    and coalesce(retry_is_correct, false) is false
  on conflict (student_id, vocab_entry_id)
  do update set
    unresolved_wrong_count =
      public.student_vocab_state.unresolved_wrong_count + 1,
    last_wrong_at = excluded.last_wrong_at,
    resolved_at = null,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at
    >= public.student_vocab_state.last_evaluated_at;

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    unresolved_wrong_count,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  select
    p_student_id,
    vocab_entry_id,
    0,
    attempt_row.deadline_at,
    p_attempt_id,
    attempt_row.deadline_at
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and (
      initial_is_correct is true
      or retry_is_correct is true
    )
  on conflict (student_id, vocab_entry_id)
  do update set
    unresolved_wrong_count = 0,
    resolved_at = excluded.resolved_at,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at
    >= public.student_vocab_state.last_evaluated_at;

  return jsonb_build_object(
    'completed', true,
    'expired', true,
    'initialScore', initial_score_value,
    'finalScore', final_score_value
  );
end;
$$;

create function private.finalize_expired_review_assignment_drafts_at_v2(
  p_student_id uuid,
  p_limit integer,
  p_evaluation_at timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_draft_ids uuid[];
  expired_draft_ids uuid[];
  finalized_count integer;
begin
  if p_student_id is null
    or p_limit is null
    or p_limit not between 1 and 1000
    or p_evaluation_at is null
  then
    raise exception 'invalid_review_draft_finalize_input'
      using errcode = '22023';
  end if;

  perform 1
  from public.students as student
  where student.id = p_student_id
  for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
    array_agg(candidate.id order by candidate.expires_at, candidate.id),
    array[]::uuid[]
  )
  into candidate_draft_ids
  from (
    select draft.id, draft.expires_at
    from public.student_vocab_review_assignment_drafts as draft
    where draft.student_id = p_student_id
      and draft.status = 'pending'
      and draft.expires_at <= p_evaluation_at
    order by draft.expires_at, draft.id
    limit p_limit
  ) as candidate;

  if cardinality(candidate_draft_ids) = 0 then
    return 0;
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = any(candidate_draft_ids)
  order by queue.id
  for update;

  perform draft.id
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = any(candidate_draft_ids)
  order by draft.id
  for update;

  with expired as (
    update public.student_vocab_review_assignment_drafts as draft
    set status = 'expired',
        expired_at = p_evaluation_at
    where draft.id = any(candidate_draft_ids)
      and draft.student_id = p_student_id
      and draft.status = 'pending'
      and draft.expires_at <= p_evaluation_at
    returning draft.id
  )
  select coalesce(array_agg(expired.id order by expired.id), array[]::uuid[])
  into expired_draft_ids
  from expired;

  finalized_count := cardinality(expired_draft_ids);
  if finalized_count = 0 then
    return 0;
  end if;

  update public.student_vocab_review_queue as queue
  set reserved_review_draft_id = null,
      reserved_at = null
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = any(expired_draft_ids);

  insert into public.audit_events (
    event_type,
    student_id,
    details
  ) values (
    'student.review_assignment_drafts.expired',
    p_student_id,
    jsonb_build_object(
      'draftCount', finalized_count,
      'draftIds', to_jsonb(expired_draft_ids)
    )
  );

  return finalized_count;
end;
$$;

-- The worker uses an exact draft id so one malformed draft cannot block the
-- same student's other expired drafts. The lock order stays student -> queue
-- -> draft, matching the bulk command path above.
create function private.finalize_expired_review_assignment_draft_at_v1(
  p_student_id uuid,
  p_draft_id uuid,
  p_evaluation_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_student_id is null
    or p_draft_id is null
    or p_evaluation_at is null
  then
    raise exception 'invalid_review_draft_finalize_input'
      using errcode = '22023';
  end if;

  perform 1
  from public.students as student
  where student.id = p_student_id
  for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = p_draft_id
  order by queue.id
  for update;

  perform draft.id
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = p_draft_id
    and draft.student_id = p_student_id
    and draft.status = 'pending'
    and draft.expires_at <= p_evaluation_at
  for update;
  if not found then
    return false;
  end if;

  update public.student_vocab_review_assignment_drafts as draft
  set status = 'expired',
      expired_at = p_evaluation_at
  where draft.id = p_draft_id
    and draft.student_id = p_student_id
    and draft.status = 'pending'
    and draft.expires_at <= p_evaluation_at;
  if not found then
    return false;
  end if;

  update public.student_vocab_review_queue as queue
  set reserved_review_draft_id = null,
      reserved_at = null
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = p_draft_id;

  insert into public.audit_events (
    event_type,
    student_id,
    details
  ) values (
    'student.review_assignment_drafts.expired',
    p_student_id,
    jsonb_build_object(
      'draftCount', 1,
      'draftIds', jsonb_build_array(p_draft_id)
    )
  );

  return true;
end;
$$;

revoke all on function private.classify_student_app_maintenance_error_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function private.record_student_app_maintenance_failure_v1(
  text, text, uuid, uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.clear_student_app_maintenance_failure_v1(
  text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.finalize_expired_quiz_attempt_at_v2(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.finalize_expired_review_assignment_drafts_at_v2(
  uuid, integer, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.finalize_expired_review_assignment_draft_at_v1(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
