-- Emergency rollback for the admin deletion-controls deployment.
--
-- Preconditions:
-- 1. Redeploy application code that does not query deletion columns first.
-- 2. Run only when no student or assignment was deleted and no history row
--    was hidden after the migration.
-- 3. If the guard fails, keep the additive schema and perform a reviewed data
--    recovery instead of making deleted records visible again.

begin;

do $guard$
begin
  if exists (
    select 1
    from public.students
    where deleted_at is not null
  ) or exists (
    select 1
    from public.assignments
    where deleted_at is not null
  ) or exists (
    select 1
    from public.admin_history_hidden_entries
  ) then
    raise exception 'admin_deletion_controls_rollback_has_activity';
  end if;
end;
$guard$;

drop function if exists public.hide_admin_history_entry_v1(
  uuid,
  uuid,
  uuid
);
drop function if exists private.hide_admin_history_entry_v1(
  uuid,
  uuid,
  uuid
);
drop function if exists public.delete_assignment_v1(uuid, text);
drop function if exists private.delete_assignment_v1(uuid, text);
drop function if exists public.delete_student_v1(uuid);
drop function if exists private.delete_student_v1(uuid);
drop function if exists private.abandon_student_attempt_v1(uuid, uuid);

drop trigger if exists assignment_students_reject_deleted_recipient
  on public.assignment_students;
drop function if exists private.reject_deleted_assignment_recipient();

drop trigger if exists assignments_reject_physical_delete
  on public.assignments;
drop function if exists private.reject_assignment_physical_delete();
drop trigger if exists students_reject_physical_delete
  on public.students;
drop function if exists private.reject_student_physical_delete();

drop trigger if exists assignments_prevent_deleted_reactivation
  on public.assignments;
drop function if exists private.prevent_deleted_assignment_reactivation();
drop trigger if exists students_prevent_deleted_reactivation
  on public.students;
drop function if exists private.prevent_deleted_student_reactivation();

create or replace function private.reject_attempt_for_missed_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_missed_at timestamptz;
  recorded_cancelled_at timestamptz;
  assignment_deadline timestamptz;
begin
  perform 1
  from public.students as student
  where student.id = new.student_id
  for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  select
    link.missed_at,
    link.cancelled_at,
    assignment.available_until
  into
    recorded_missed_at,
    recorded_cancelled_at,
    assignment_deadline
  from public.assignment_students as link
  join public.assignments as assignment
    on assignment.id = link.assignment_id
  where link.assignment_id = new.assignment_id
    and link.student_id = new.student_id
  for update of link;

  if not found then
    raise exception 'assignment_not_owned' using errcode = '42501';
  end if;
  if recorded_cancelled_at is not null then
    raise exception 'assignment_cancelled' using errcode = '22023';
  end if;
  if recorded_missed_at is not null then
    raise exception 'assignment_already_missed' using errcode = '22023';
  end if;
  if assignment_deadline is not null
    and assignment_deadline <= now()
  then
    raise exception 'assignment_unavailable' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_attempt_for_missed_assignment()
  from public, anon, authenticated, service_role;

create or replace function private.reject_assignment_student_history_delete()
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

drop table public.admin_history_hidden_entries;

alter table public.assignments
  drop constraint assignments_deletion_state_check,
  drop column deletion_reason,
  drop column deleted_by,
  drop column deleted_at;

alter table public.students
  drop constraint students_deletion_state_check,
  drop column deleted_by,
  drop column deleted_at;

notify pgrst, 'reload schema';

commit;
