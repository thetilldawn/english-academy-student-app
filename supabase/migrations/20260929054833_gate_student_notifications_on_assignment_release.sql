-- APP-20260929-07: only claim notifications for exams the student can open.
-- Preserve existing receipts, schedules, role boundaries and all student records.
begin;

create or replace function public.claim_student_notifications_v1(
  p_student_id uuid
)
returns table (
  new_assignment_count integer,
  deadline_soon_count integer
)
language sql
security invoker
set search_path = ''
as $$
  with claimed_assignments as (
    insert into public.notification_receipts (
      viewer_role,
      viewer_id,
      notification_type,
      assignment_id,
      student_id,
      deadline_version
    )
    select
      'student',
      p_student_id,
      'new_assignment',
      assignment_link.assignment_id,
      assignment_link.student_id,
      '-infinity'::timestamptz
    from public.assignment_students as assignment_link
    join public.assignments as assignment
      on assignment.id = assignment_link.assignment_id
    where assignment_link.student_id = p_student_id
      and assignment_link.cancelled_at is null
      and assignment_link.missed_at is null
      and assignment.deleted_at is null
      and assignment.status = 'active'
      and (assignment.available_from is null
        or assignment.available_from <= clock_timestamp())
      and (private.student_assignment_release_v1(
        assignment_link.student_id, assignment_link.assignment_id, clock_timestamp()
      )->>'state') in ('open', 'unrestricted')
      and not exists (
        select 1
        from public.quiz_attempts as attempt
        where attempt.assignment_id = assignment_link.assignment_id
          and attempt.student_id = assignment_link.student_id
      )
    on conflict do nothing
    returning 1
  ),
  claimed_deadlines as (
    insert into public.notification_receipts (
      viewer_role,
      viewer_id,
      notification_type,
      assignment_id,
      student_id,
      deadline_version
    )
    select
      'student',
      p_student_id,
      'deadline_soon',
      assignment_link.assignment_id,
      assignment_link.student_id,
      assignment.available_until
    from public.assignment_students as assignment_link
    join public.assignments as assignment
      on assignment.id = assignment_link.assignment_id
    where assignment_link.student_id = p_student_id
      and assignment_link.cancelled_at is null
      and assignment_link.missed_at is null
      and assignment.deleted_at is null
      and assignment.status = 'active'
      and (assignment.available_from is null
        or assignment.available_from <= clock_timestamp())
      and (private.student_assignment_release_v1(
        assignment_link.student_id, assignment_link.assignment_id, clock_timestamp()
      )->>'state') in ('open', 'unrestricted')
      and assignment.available_until > clock_timestamp()
      and assignment.available_until <= clock_timestamp() + interval '8 hours'
      and not exists (
        select 1
        from public.quiz_attempts as attempt
        where attempt.assignment_id = assignment_link.assignment_id
          and attempt.student_id = assignment_link.student_id
      )
    on conflict do nothing
    returning 1
  )
  select
    (select count(*)::integer from claimed_assignments),
    (select count(*)::integer from claimed_deadlines);
$$;

revoke all on function public.claim_student_notifications_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_student_notifications_v1(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
