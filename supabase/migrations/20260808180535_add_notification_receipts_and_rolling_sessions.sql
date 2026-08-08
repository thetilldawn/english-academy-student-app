create table public.notification_receipts (
  viewer_role text not null check (viewer_role in ('student', 'admin')),
  viewer_id uuid not null,
  notification_type text not null check (
    notification_type in ('new_assignment', 'deadline_soon')
  ),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  deadline_version timestamptz not null default '-infinity'::timestamptz,
  displayed_at timestamptz not null default clock_timestamp(),
  primary key (
    viewer_role,
    viewer_id,
    notification_type,
    assignment_id,
    student_id,
    deadline_version
  )
);

create index notification_receipts_assignment_idx
  on public.notification_receipts (assignment_id, student_id);

create index notification_receipts_viewer_idx
  on public.notification_receipts (viewer_role, viewer_id, displayed_at desc);

alter table public.notification_receipts enable row level security;

revoke all on table public.notification_receipts
  from public, anon, authenticated;
grant select, insert on table public.notification_receipts to service_role;

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

create or replace function public.claim_admin_notifications_v1(
  p_admin_id uuid
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
      'admin',
      p_admin_id,
      'new_assignment',
      assignment_link.assignment_id,
      assignment_link.student_id,
      '-infinity'::timestamptz
    from public.assignment_students as assignment_link
    join public.assignments as assignment
      on assignment.id = assignment_link.assignment_id
    where assignment_link.cancelled_at is null
      and assignment.deleted_at is null
      and assignment_link.assigned_by <> p_admin_id
    on conflict do nothing
    returning 1
  )
  select
    (select count(*)::integer from claimed_assignments),
    0::integer;
$$;

create or replace function private.acknowledge_assigning_admin_notification_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_receipts (
    viewer_role,
    viewer_id,
    notification_type,
    assignment_id,
    student_id,
    deadline_version
  )
  values (
    'admin',
    new.assigned_by,
    'new_assignment',
    new.assignment_id,
    new.student_id,
    '-infinity'::timestamptz
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.acknowledge_assigning_admin_notification_v1()
  from public, anon, authenticated, service_role;

create trigger assignment_students_acknowledge_assigning_admin_notification
after insert on public.assignment_students
for each row
execute function private.acknowledge_assigning_admin_notification_v1();

create or replace function public.refresh_student_session_v1(
  p_token_hash text
)
returns table (
  session_id uuid,
  expires_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  update public.student_sessions as session
  set
    last_seen_at = clock_timestamp(),
    expires_at = clock_timestamp() + interval '60 days'
  from public.students as student
  where session.token_hash = p_token_hash
    and session.student_id = student.id
    and session.revoked_at is null
    and session.expires_at > clock_timestamp()
    and student.deleted_at is null
    and student.status = 'active'
    and student.code_generation = session.code_generation
  returning session.id, session.expires_at;
$$;

revoke all on function public.claim_student_notifications_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_admin_notifications_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_student_session_v1(text)
  from public, anon, authenticated;

grant execute on function public.claim_student_notifications_v1(uuid)
  to service_role;
grant execute on function public.claim_admin_notifications_v1(uuid)
  to service_role;
grant execute on function public.refresh_student_session_v1(text)
  to service_role;

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
  assignment_link.student_id,
  'new_assignment',
  assignment_link.assignment_id,
  assignment_link.student_id,
  '-infinity'::timestamptz
from public.assignment_students as assignment_link
join public.assignments as assignment
  on assignment.id = assignment_link.assignment_id
where assignment_link.cancelled_at is null
  and assignment.deleted_at is null
on conflict do nothing;

insert into public.notification_receipts (
  viewer_role,
  viewer_id,
  notification_type,
  assignment_id,
  student_id,
  deadline_version
)
select
  'admin',
  admin.user_id,
  'new_assignment',
  assignment_link.assignment_id,
  assignment_link.student_id,
  '-infinity'::timestamptz
from public.admin_profiles as admin
cross join public.assignment_students as assignment_link
join public.assignments as assignment
  on assignment.id = assignment_link.assignment_id
where admin.is_active
  and assignment_link.cancelled_at is null
  and assignment.deleted_at is null
on conflict do nothing;
