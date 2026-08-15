begin;

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
      + make_interval(secs => per_question_seconds);

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
      case
        when timing_mode_value = 'per_question'
          then clock_timestamp() + interval '750 milliseconds'
        else clock_timestamp()
      end;

    update public.quiz_attempts
    set current_question_started_at = next_question_started_at
    where id = p_attempt_id;

    if timing_mode_value = 'per_question' then
      next_deadline :=
        next_question_started_at
        + make_interval(secs => per_question_seconds);
    else
      next_deadline := attempt_row.deadline_at;
    end if;
  end if;

  return result || jsonb_build_object(
    'timedOut', timed_out,
    'questionDeadlineAt', next_deadline
  );
end;
$$;

revoke all on function public.answer_quiz_question_v2(
  uuid,
  uuid,
  uuid,
  text,
  smallint,
  boolean
) from public, anon, authenticated;

grant execute on function public.answer_quiz_question_v2(
  uuid,
  uuid,
  uuid,
  text,
  smallint,
  boolean
) to service_role;

notify pgrst, 'reload schema';

commit;
