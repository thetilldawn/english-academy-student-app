begin;

alter table public.assignment_students
  add column missed_at timestamptz;

alter table public.assignment_students
  add constraint assignment_students_missed_after_assignment
  check (missed_at is null or missed_at >= assigned_at);

alter table public.assignment_students
  drop constraint assignment_students_student_id_fkey;

alter table public.assignment_students
  add constraint assignment_students_student_id_fkey
    foreign key (student_id)
    references public.students(id)
    on delete restrict
    not valid;

alter table public.assignment_students
  validate constraint assignment_students_student_id_fkey;

create index assignment_students_pending_missed_idx
  on public.assignment_students (assignment_id, student_id)
  where missed_at is null;

create index assignments_available_until_idx
  on public.assignments (available_until, id)
  where available_until is not null;

create function private.reject_attempt_for_missed_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_missed_at timestamptz;
  assignment_deadline timestamptz;
begin
  perform 1
  from public.students as student
  where student.id = new.student_id
  for update;
  if not found then
    raise exception 'student_not_found'
      using errcode = 'P0002';
  end if;

  select
    link.missed_at,
    assignment.available_until
  into
    recorded_missed_at,
    assignment_deadline
  from public.assignment_students as link
  join public.assignments as assignment
    on assignment.id = link.assignment_id
  where link.assignment_id = new.assignment_id
    and link.student_id = new.student_id
  for update of link;

  if not found then
    raise exception 'assignment_not_owned'
      using errcode = '42501';
  end if;

  if recorded_missed_at is not null then
    raise exception 'assignment_already_missed'
      using errcode = '22023';
  end if;
  if assignment_deadline is not null
    and assignment_deadline <= now()
  then
    raise exception 'assignment_unavailable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.reject_attempt_for_missed_assignment()
  from public, anon, authenticated, service_role;

create trigger quiz_attempts_reject_missed_assignment
before insert on public.quiz_attempts
for each row
execute function private.reject_attempt_for_missed_assignment();

create function private.reject_assignment_student_history_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.missed_at is not null
    or exists (
      select 1
      from public.quiz_attempts as attempt
      where attempt.assignment_id = old.assignment_id
        and attempt.student_id = old.student_id
    )
  then
    raise exception 'assignment_student_history_exists'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

revoke all on function private.reject_assignment_student_history_delete()
  from public, anon, authenticated, service_role;

create trigger assignment_students_preserve_history
before delete on public.assignment_students
for each row
execute function private.reject_assignment_student_history_delete();

create function public.finalize_missed_assignments(
  p_student_id uuid default null,
  p_limit integer default 100
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate record;
  locked_missed_at timestamptz;
  current_deadline timestamptz;
  finalization_cutoff timestamptz := clock_timestamp();
  finalized_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_finalize_limit' using errcode = '22023';
  end if;

  for candidate in
    select
      link.assignment_id,
      link.student_id
    from public.assignments as assignment
    join public.assignment_students as link
      on link.assignment_id = assignment.id
    where link.missed_at is null
      and assignment.available_until is not null
      and assignment.available_until <= finalization_cutoff
      and (
        p_student_id is null
        or link.student_id = p_student_id
      )
      and not exists (
        select 1
        from public.quiz_attempts as attempt
        where attempt.assignment_id = link.assignment_id
          and attempt.student_id = link.student_id
      )
    order by
      assignment.available_until,
      link.assignment_id,
      link.student_id
    limit p_limit
  loop
    perform 1
    from public.students as student
    where student.id = candidate.student_id
    for update skip locked;
    if not found then
      continue;
    end if;

    locked_missed_at := null;
    select link.missed_at
    into locked_missed_at
    from public.assignment_students as link
    where link.assignment_id = candidate.assignment_id
      and link.student_id = candidate.student_id
    for update skip locked;
    if not found or locked_missed_at is not null then
      continue;
    end if;

    select assignment.available_until
    into current_deadline
    from public.assignments as assignment
    where assignment.id = candidate.assignment_id;
    if current_deadline is null
      or current_deadline > finalization_cutoff
      or exists (
        select 1
        from public.quiz_attempts as attempt
        where attempt.assignment_id = candidate.assignment_id
          and attempt.student_id = candidate.student_id
      )
    then
      continue;
    end if;

    update public.assignment_students as link
    set missed_at = current_deadline
    where link.assignment_id = candidate.assignment_id
      and link.student_id = candidate.student_id
      and link.missed_at is null;
    if found then
      insert into public.audit_events (
        event_type,
        student_id,
        details
      )
      values (
        'assignment.missed',
        candidate.student_id,
        jsonb_build_object(
          'assignment_id', candidate.assignment_id,
          'missed_at', current_deadline
        )
      );
      finalized_count := finalized_count + 1;
    end if;
  end loop;

  return finalized_count;
end;
$$;

revoke all on function public.finalize_missed_assignments(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_missed_assignments(uuid, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
