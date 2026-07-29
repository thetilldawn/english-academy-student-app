begin;

-- A missed assignment is derived from the durable assignment/student link.
-- Do not allow an assignment delete to erase that history silently.
alter table public.assignment_students
  drop constraint if exists assignment_students_assignment_id_fkey;

alter table public.assignment_students
  add constraint assignment_students_assignment_id_fkey
    foreign key (assignment_id)
    references public.assignments(id)
    on delete restrict
    not valid;

alter table public.assignment_students
  validate constraint assignment_students_assignment_id_fkey;

-- Only timed phases can become stale. The review phase is intentionally
-- untimed and is excluded both here and in the finalizer.
create index if not exists quiz_attempts_active_deadline_idx
  on public.quiz_attempts (deadline_at, id)
  where status = 'in_progress'
    and phase in ('initial', 'retry');

create function private.create_assignment_with_question_bank_v3(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_available_until is not null
    and p_available_until <= clock_timestamp()
  then
    raise exception 'assignment_deadline_must_be_future'
      using errcode = '22023';
  end if;

  created_assignment_id :=
    private.create_assignment_with_question_bank_v2(
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_student_ids,
      p_questions
    );

  if p_available_until is not null
    and p_available_until <= clock_timestamp()
  then
    raise exception 'assignment_deadline_elapsed_during_creation'
      using errcode = '22023';
  end if;

  update public.assignments
  set available_until = p_available_until
  where id = created_assignment_id;

  if p_available_until is not null then
    insert into public.audit_events (
      event_type,
      actor_admin_id,
      details
    )
    values (
      'assignment.deadline_scheduled',
      (select auth.uid()),
      jsonb_build_object(
        'assignment_id', created_assignment_id,
        'available_until', p_available_until
      )
    );
  end if;

  return created_assignment_id;
end;
$$;

create function public.create_assignment_with_question_bank_v3(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.create_assignment_with_question_bank_v3(
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_questions
  );
end;
$$;

revoke all on function private.create_assignment_with_question_bank_v3(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  uuid[],
  jsonb
) from public, anon, authenticated;

revoke all on function public.create_assignment_with_question_bank_v3(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  uuid[],
  jsonb
) from public, anon;

grant execute on function private.create_assignment_with_question_bank_v3(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  uuid[],
  jsonb
) to authenticated, service_role;

grant execute on function public.create_assignment_with_question_bank_v3(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  uuid[],
  jsonb
) to authenticated, service_role;

create function public.finalize_stale_quiz_attempts(
  p_limit integer default 100
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stale_attempt record;
  finalized_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_finalize_limit' using errcode = '22023';
  end if;

  for stale_attempt in
    select attempt.id, attempt.student_id
    from public.quiz_attempts as attempt
    where attempt.status = 'in_progress'
      and attempt.phase in ('initial', 'retry')
      and attempt.deadline_at <= now()
    order by attempt.deadline_at, attempt.id
    for update skip locked
    limit p_limit
  loop
    perform private.finalize_expired_quiz_attempt(
      stale_attempt.student_id,
      stale_attempt.id
    );
    finalized_count := finalized_count + 1;
  end loop;

  return finalized_count;
end;
$$;

revoke all on function public.finalize_stale_quiz_attempts(integer)
  from public, anon, authenticated;
grant execute on function public.finalize_stale_quiz_attempts(integer)
  to service_role;

create function public.finalize_quiz_attempt_if_stale(
  p_attempt_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stale_attempt record;
begin
  select
    attempt.id,
    attempt.student_id
  into stale_attempt
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.status = 'in_progress'
    and attempt.phase in ('initial', 'retry')
    and attempt.deadline_at <= now()
  for update;

  if not found then
    return false;
  end if;

  perform private.finalize_expired_quiz_attempt(
    stale_attempt.student_id,
    stale_attempt.id
  );

  return true;
end;
$$;

revoke all on function public.finalize_quiz_attempt_if_stale(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_quiz_attempt_if_stale(uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
