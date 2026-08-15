begin;

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, 'interval ''3000 milliseconds''') <> 2 then
    raise exception 'quiz_feedback_reservation_guard_not_found';
  end if;

  v_updated := replace(
    v_definition,
    'interval ''3000 milliseconds''',
    'interval ''7000 milliseconds'''
  );
  execute v_updated;
end;
$$;

create function public.resume_quiz_after_feedback_v2(
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
  else
    next_deadline := attempt_row.deadline_at - unused_feedback;
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at,
        deadline_at = next_deadline
    where id = p_attempt_id;
  end if;

  return jsonb_build_object(
    'questionStartsAt', adjusted_started_at,
    'questionDeadlineAt', next_deadline
  );
end;
$$;

create or replace function public.answer_quiz_question_v3(
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
  answered_at timestamptz;
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
  if clock_timestamp() < attempt_row.current_question_started_at then
    raise exception 'question_not_started' using errcode = '22023';
  end if;
  if p_phase is null or p_phase not in ('initial', 'retry') then
    raise exception 'invalid_phase' using errcode = '22023';
  end if;

  if p_phase = 'initial' then
    select question.initial_answered_at
    into answered_at
    from public.quiz_questions as question
    where question.id = p_question_id
      and question.attempt_id = p_attempt_id;
  else
    select question.retry_answered_at
    into answered_at
    from public.quiz_questions as question
    where question.id = p_question_id
      and question.attempt_id = p_attempt_id;
  end if;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;
  if answered_at is not null then
    raise exception 'question_already_answered' using errcode = '22023';
  end if;

  return public.answer_quiz_question_v2(
    p_student_id,
    p_attempt_id,
    p_question_id,
    p_phase,
    p_choice_index,
    p_force_timeout
  );
end;
$$;

revoke all on function public.resume_quiz_after_feedback_v2(
  uuid,
  uuid,
  uuid,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.resume_quiz_after_feedback_v2(
  uuid,
  uuid,
  uuid,
  text,
  integer
) to service_role;

revoke all on function public.answer_quiz_question_v3(
  uuid,
  uuid,
  uuid,
  text,
  smallint,
  boolean
) from public, anon, authenticated;

grant execute on function public.answer_quiz_question_v3(
  uuid,
  uuid,
  uuid,
  text,
  smallint,
  boolean
) to service_role;

notify pgrst, 'reload schema';

commit;
