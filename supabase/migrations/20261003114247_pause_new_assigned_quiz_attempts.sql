-- Operator-only control. Changing this row must be its own short transaction:
-- commit before deployment, preservation scans, or touching any student row.
create table private.quiz_start_control (
  singleton boolean primary key default true check (singleton),
  paused boolean not null default false,
  changed_at timestamptz not null default clock_timestamp()
);
alter table private.quiz_start_control enable row level security;
revoke all on table private.quiz_start_control from public, anon, authenticated, service_role;
insert into private.quiz_start_control(singleton, paused) values (true, false);

create or replace function private.guard_new_attempt_release_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare release_state text; starts_paused boolean;
begin
  -- Preserve the existing student lock order. Concurrent starts share this row;
  -- an operator UPDATE must wait for admitted starts to commit (and vice versa).
  perform 1 from public.students where id = new.student_id for update;
  select c.paused into starts_paused from private.quiz_start_control c
    where c.singleton for share;
  if not found then
    raise exception 'quiz_start_control_unavailable' using errcode = '55000';
  end if;
  if starts_paused then
    raise exception 'quiz_new_attempts_paused' using errcode = '55000';
  end if;
  release_state := private.student_assignment_release_v1(new.student_id, new.assignment_id, clock_timestamp())->>'state';
  if release_state not in ('open','unrestricted') then
    raise exception 'assignment_release_%', release_state using errcode = '55000';
  end if;
  return new;
end;
$$;
