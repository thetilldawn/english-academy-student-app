create or replace function private.reset_question_clock_on_retry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phase = 'retry' and old.phase is distinct from new.phase then
    new.current_question_started_at := coalesce(
      new.retry_started_at,
      clock_timestamp()
    );
  end if;
  return new;
end;
$$;

create or replace function public.start_quiz_retry(
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  initial_unanswered integer;
  initial_wrong integer;
  retry_unanswered integer;
  next_question_id uuid;
  retry_start_time timestamptz;
  retry_deadline timestamptz;
begin
  select *
    into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;

  if attempt_row.phase = 'retry' then
    if attempt_row.deadline_at <= now() then
      raise exception 'attempt_expired' using errcode = '22023';
    end if;

    select id
      into next_question_id
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and retry_choice_index is null
    order by order_index
    limit 1;

    return jsonb_build_object(
      'phase', 'retry',
      'nextQuestionId', next_question_id,
      'deadlineAt', attempt_row.deadline_at
    );
  end if;

  if attempt_row.phase <> 'review' then
    raise exception 'attempt_not_in_review' using errcode = '22023';
  end if;

  select
    count(*) filter (where initial_choice_index is null),
    count(*) filter (where initial_is_correct is false),
    count(*) filter (
      where initial_is_correct is false
        and retry_choice_index is null
    )
  into
    initial_unanswered,
    initial_wrong,
    retry_unanswered
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  if initial_unanswered > 0 then
    raise exception 'initial_phase_incomplete' using errcode = '22023';
  end if;

  if initial_wrong = 0 or retry_unanswered = 0 then
    raise exception 'retry_not_required' using errcode = '22023';
  end if;

  select id
    into next_question_id
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and initial_is_correct is false
    and retry_choice_index is null
  order by order_index
  limit 1;

  retry_start_time := clock_timestamp();
  retry_deadline := retry_start_time
    + make_interval(secs => attempt_row.time_limit_seconds_snapshot);

  update public.quiz_attempts
  set phase = 'retry',
      retry_started_at = retry_start_time,
      deadline_at = retry_deadline,
      current_question_started_at = retry_start_time
  where id = p_attempt_id;

  return jsonb_build_object(
    'phase', 'retry',
    'nextQuestionId', next_question_id,
    'deadlineAt', retry_deadline
  );
end;
$$;

revoke all on function public.start_quiz_retry(
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.start_quiz_retry(
  uuid,
  uuid
) to service_role;

notify pgrst, 'reload schema';
