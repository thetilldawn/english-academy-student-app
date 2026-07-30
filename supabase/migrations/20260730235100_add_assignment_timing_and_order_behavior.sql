alter table public.assignments
  add column timing_mode text not null default 'total'
    check (timing_mode in ('total', 'per_question')),
  add column question_time_limit_seconds integer
    check (
      question_time_limit_seconds is null
      or question_time_limit_seconds between 5 and 600
    ),
  add constraint assignments_timing_mode_consistent check (
    (timing_mode = 'total' and question_time_limit_seconds is null)
    or
    (timing_mode = 'per_question' and question_time_limit_seconds is not null)
  );

alter table public.quiz_attempts
  add column current_question_started_at timestamptz;

update public.quiz_attempts
set current_question_started_at = coalesce(started_at, now())
where current_question_started_at is null;

alter table public.quiz_attempts
  alter column current_question_started_at set default now(),
  alter column current_question_started_at set not null;

alter table public.quiz_questions
  add column initial_timed_out boolean not null default false,
  add column retry_timed_out boolean not null default false;

create or replace function public.create_quiz_attempt_from_bank(
  p_student_id uuid,
  p_assignment_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  assignment_row public.assignments%rowtype;
  created_attempt_id uuid;
  next_attempt_number integer;
  stale_attempt_id uuid;
  inserted_question_count integer;
begin
  perform 1
  from public.students
  where id = p_student_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  select *
  into assignment_row
  from public.assignments
  where id = p_assignment_id
    and status = 'active'
    and range_basis = 'units'
    and question_bank_version is not null;

  if not found
    or (
      assignment_row.available_from is not null
      and assignment_row.available_from > now()
    )
    or (
      assignment_row.available_until is not null
      and assignment_row.available_until <= now()
    )
  then
    raise exception 'assignment_unavailable' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.assignment_students
    where assignment_id = p_assignment_id
      and student_id = p_student_id
  ) then
    raise exception 'assignment_not_owned' using errcode = '42501';
  end if;

  for stale_attempt_id in
    select id
    from public.quiz_attempts
    where assignment_id = p_assignment_id
      and student_id = p_student_id
      and status = 'in_progress'
      and deadline_at <= now()
  loop
    perform private.finalize_expired_quiz_attempt(
      p_student_id,
      stale_attempt_id
    );
  end loop;

  if not assignment_row.retake_allowed and exists (
    select 1
    from public.quiz_attempts
    where assignment_id = p_assignment_id
      and student_id = p_student_id
      and status = 'completed'
  ) then
    raise exception 'retake_not_allowed' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.quiz_attempts
    where assignment_id = p_assignment_id
      and student_id = p_student_id
      and status = 'in_progress'
  ) then
    raise exception 'attempt_already_in_progress' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.assignment_questions
    where assignment_id = p_assignment_id
  ) <> assignment_row.question_count then
    raise exception 'question_bank_incomplete' using errcode = '22023';
  end if;

  select coalesce(max(attempt_number), 0) + 1
  into next_attempt_number
  from public.quiz_attempts
  where assignment_id = p_assignment_id
    and student_id = p_student_id;

  insert into public.quiz_attempts (
    student_id,
    assignment_id,
    attempt_number,
    status,
    started_at,
    deadline_at,
    current_question_started_at,
    question_count_snapshot,
    time_limit_seconds_snapshot,
    passing_score_snapshot,
    passing_basis_snapshot
  )
  values (
    p_student_id,
    p_assignment_id,
    next_attempt_number,
    'in_progress',
    now(),
    now() + make_interval(secs => assignment_row.time_limit_seconds),
    now(),
    assignment_row.question_count,
    assignment_row.time_limit_seconds,
    assignment_row.passing_score,
    assignment_row.passing_basis
  )
  returning id into created_attempt_id;

  with ordered_bank as (
    select
      question.*,
      row_number() over (
        order by
          case
            when assignment_row.question_order_mode in ('fixed', 'ascending')
              then question.base_order_index
          end asc,
          case
            when assignment_row.question_order_mode = 'descending'
              then question.base_order_index
          end desc,
          case
            when assignment_row.question_order_mode = 'random'
              then random()
          end,
          question.base_order_index
      )::integer as attempt_order_index
    from public.assignment_questions as question
    where question.assignment_id = p_assignment_id
  )
  insert into public.quiz_questions (
    attempt_id,
    vocab_entry_id,
    assignment_question_id,
    order_index,
    direction,
    prompt,
    choices,
    correct_choice_index
  )
  select
    created_attempt_id,
    question.vocab_entry_id,
    question.id,
    question.attempt_order_index,
    question.direction,
    question.prompt,
    question.choices,
    question.correct_choice_index
  from ordered_bank as question;

  get diagnostics inserted_question_count = row_count;
  if inserted_question_count <> assignment_row.question_count then
    raise exception 'question_insert_mismatch' using errcode = '22023';
  end if;

  return created_attempt_id;
end;
$$;

create function public.configure_assignment_delivery_v1(
  p_assignment_id uuid,
  p_timing_mode text,
  p_question_time_limit_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_timing_mode not in ('total', 'per_question')
    or (
      p_timing_mode = 'total'
      and p_question_time_limit_seconds is not null
    )
    or (
      p_timing_mode = 'per_question'
      and (
        p_question_time_limit_seconds is null
        or p_question_time_limit_seconds not between 5 and 600
      )
    )
  then
    raise exception 'invalid_timing_settings' using errcode = '22023';
  end if;

  perform 1
  from public.assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.quiz_attempts
    where assignment_id = p_assignment_id
  ) then
    raise exception 'assignment_already_started' using errcode = '22023';
  end if;

  update public.assignments
  set timing_mode = p_timing_mode,
      question_time_limit_seconds = p_question_time_limit_seconds,
      updated_at = now()
  where id = p_assignment_id;
end;
$$;

create function public.answer_quiz_question_v2(
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
    update public.quiz_attempts
    set current_question_started_at = clock_timestamp()
    where id = p_attempt_id;

    if timing_mode_value = 'per_question' then
      next_deadline :=
        clock_timestamp() + make_interval(secs => per_question_seconds);
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

create function private.reset_question_clock_on_retry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phase = 'retry' and old.phase is distinct from new.phase then
    new.current_question_started_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger quiz_attempts_reset_question_clock_on_retry
before update of phase on public.quiz_attempts
for each row
execute function private.reset_question_clock_on_retry();

revoke all on function public.configure_assignment_delivery_v1(
  uuid,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.configure_assignment_delivery_v1(
  uuid,
  text,
  integer
) to authenticated, service_role;

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
