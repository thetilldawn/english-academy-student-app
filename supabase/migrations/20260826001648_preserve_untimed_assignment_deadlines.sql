begin;

-- An untimed assignment may still have an absolute availability deadline.
-- Feedback pauses may extend a total timer, but must never move that deadline.
create or replace function public.answer_quiz_question_v2(
  p_student_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_phase text,
  p_choice_index smallint,
  p_force_timeout boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  timing_mode_value text;
  per_question_seconds integer;
  correct_choice smallint;
  effective_choice smallint;
  timed_out boolean := false;
  result jsonb;
  next_question_started_at timestamptz;
  next_deadline timestamptz;
begin
  select attempt.*
  into attempt_row
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  select assignment.timing_mode, assignment.question_time_limit_seconds
  into timing_mode_value, per_question_seconds
  from public.assignments as assignment
  where assignment.id = attempt_row.assignment_id;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;

  select question.correct_choice_index
  into correct_choice
  from public.quiz_questions as question
  where question.id = p_question_id
    and question.attempt_id = p_attempt_id;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  timed_out :=
    timing_mode_value = 'per_question'
    and clock_timestamp() >=
      attempt_row.current_question_started_at
      + make_interval(secs => per_question_seconds)
      + case
          when p_force_timeout then interval '0 milliseconds'
          else interval '250 milliseconds'
        end;

  if p_force_timeout and not timed_out then
    raise exception 'question_time_remaining' using errcode = '22023';
  end if;

  if timed_out then
    effective_choice := ((correct_choice + 1) % 4)::smallint;
  else
    if p_force_timeout then
      raise exception 'timeout_not_available' using errcode = '22023';
    end if;
    effective_choice := p_choice_index;
  end if;

  result := public.answer_quiz_question(
    p_student_id,
    p_attempt_id,
    p_question_id,
    p_phase,
    effective_choice
  );

  if timed_out and coalesce((result ->> 'expired')::boolean, false) is false then
    if p_phase = 'initial' then
      update public.quiz_questions
      set initial_timed_out = true
      where id = p_question_id;
    else
      update public.quiz_questions
      set retry_timed_out = true
      where id = p_question_id;
    end if;
  end if;

  if coalesce((result ->> 'completed')::boolean, false) is false
    and result ->> 'nextQuestionId' is not null
  then
    next_question_started_at :=
      clock_timestamp() + interval '7000 milliseconds';

    if timing_mode_value = 'per_question' then
      next_deadline :=
        next_question_started_at
        + make_interval(secs => per_question_seconds);
      update public.quiz_attempts
      set current_question_started_at = next_question_started_at
      where id = p_attempt_id;
    elsif timing_mode_value = 'total' then
      next_deadline :=
        attempt_row.deadline_at + interval '7000 milliseconds';
      update public.quiz_attempts
      set current_question_started_at = next_question_started_at,
          deadline_at = next_deadline
      where id = p_attempt_id;
    elsif timing_mode_value = 'none' then
      next_deadline := attempt_row.deadline_at;
      update public.quiz_attempts
      set current_question_started_at = next_question_started_at
      where id = p_attempt_id;
    else
      raise exception 'invalid_timing_mode' using errcode = '22023';
    end if;
  end if;

  return result || jsonb_build_object(
    'timedOut', timed_out,
    'questionDeadlineAt', next_deadline
  );
end;
$$;

create or replace function public.resume_quiz_after_feedback_v2(
  p_student_id uuid,
  p_attempt_id uuid,
  p_next_question_id uuid,
  p_next_phase text,
  p_transition_remaining_milliseconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  timing_mode_value text;
  per_question_seconds integer;
  current_question_id uuid;
  resume_requested_at timestamptz := clock_timestamp();
  adjusted_started_at timestamptz;
  unused_feedback interval;
  next_deadline timestamptz;
begin
  if p_next_phase is null or p_next_phase not in ('initial', 'retry') then
    raise exception 'invalid_phase' using errcode = '22023';
  end if;
  if p_transition_remaining_milliseconds is null
    or p_transition_remaining_milliseconds < 0
    or p_transition_remaining_milliseconds > 750
  then
    raise exception 'invalid_feedback_delay' using errcode = '22023';
  end if;

  select attempt.*
  into attempt_row
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;
  if attempt_row.phase::text <> p_next_phase then
    raise exception 'attempt_phase_mismatch' using errcode = '22023';
  end if;

  if p_next_phase = 'initial' then
    select question.id
    into current_question_id
    from public.quiz_questions as question
    where question.attempt_id = p_attempt_id
      and question.initial_choice_index is null
    order by question.order_index
    limit 1;
  else
    select question.id
    into current_question_id
    from public.quiz_questions as question
    where question.attempt_id = p_attempt_id
      and question.initial_is_correct is false
      and question.retry_choice_index is null
    order by question.order_index
    limit 1;
  end if;

  if current_question_id is distinct from p_next_question_id then
    raise exception 'next_question_mismatch' using errcode = '22023';
  end if;

  select assignment.timing_mode, assignment.question_time_limit_seconds
  into timing_mode_value, per_question_seconds
  from public.assignments as assignment
  where assignment.id = attempt_row.assignment_id;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if timing_mode_value = 'per_question' and per_question_seconds is null then
    raise exception 'question_time_limit_missing' using errcode = '22023';
  end if;
  if attempt_row.current_question_started_at
    > resume_requested_at + interval '7250 milliseconds'
  then
    raise exception 'feedback_window_invalid' using errcode = '22023';
  end if;

  adjusted_started_at := least(
    attempt_row.current_question_started_at,
    resume_requested_at + make_interval(
      secs => p_transition_remaining_milliseconds::double precision / 1000
    )
  );
  unused_feedback := greatest(
    interval '0 milliseconds',
    attempt_row.current_question_started_at - adjusted_started_at
  );

  if timing_mode_value = 'per_question' then
    next_deadline :=
      adjusted_started_at + make_interval(secs => per_question_seconds);
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at
    where id = p_attempt_id;
  elsif timing_mode_value = 'total' then
    next_deadline := attempt_row.deadline_at - unused_feedback;
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at,
        deadline_at = next_deadline
    where id = p_attempt_id;
  elsif timing_mode_value = 'none' then
    next_deadline := attempt_row.deadline_at;
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at
    where id = p_attempt_id;
  else
    raise exception 'invalid_timing_mode' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'questionStartsAt', adjusted_started_at,
    'questionDeadlineAt', next_deadline
  );
end;
$$;

revoke all on function public.answer_quiz_question_v2(
  uuid, uuid, uuid, text, smallint, boolean
) from public, anon, authenticated;
grant execute on function public.answer_quiz_question_v2(
  uuid, uuid, uuid, text, smallint, boolean
) to service_role;

revoke all on function public.resume_quiz_after_feedback_v2(
  uuid, uuid, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.resume_quiz_after_feedback_v2(
  uuid, uuid, uuid, text, integer
) to service_role;

notify pgrst, 'reload schema';

commit;
