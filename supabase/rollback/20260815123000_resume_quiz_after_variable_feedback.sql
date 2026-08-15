begin;

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, 'interval ''7000 milliseconds''') <> 2 then
    raise exception 'quiz_feedback_reservation_rollback_guard_not_found';
  end if;

  v_updated := replace(
    v_definition,
    'interval ''7000 milliseconds''',
    'interval ''3000 milliseconds'''
  );
  execute v_updated;
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
  answered_at timestamptz;
begin
  perform 1
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
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

drop function if exists public.resume_quiz_after_feedback_v2(
  uuid,
  uuid,
  uuid,
  text,
  integer
);

notify pgrst, 'reload schema';

commit;
