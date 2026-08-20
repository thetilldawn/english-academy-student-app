create table public.class_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index class_groups_active_name_idx
  on public.class_groups (lower(trim(name)))
  where active;

create index class_groups_created_by_idx
  on public.class_groups (created_by);

create table public.class_group_students (
  class_group_id uuid not null
    references public.class_groups(id) on delete cascade,
  student_id uuid not null
    references public.students(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (class_group_id, student_id)
);

create index class_group_students_student_idx
  on public.class_group_students (student_id, class_group_id);

create index class_group_students_created_by_idx
  on public.class_group_students (created_by);

create table public.admin_vocab_assignment_time_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null
    check (char_length(trim(name)) between 1 and 30)
    check (trim(name) not in ('수업 후', '저녁', '당일 마감')),
  available_time time not null,
  deadline_day_offset integer not null check (deadline_day_offset between 0 and 30),
  deadline_time time not null,
  timing_mode text not null check (timing_mode in ('total', 'per_question')),
  total_seconds integer check (total_seconds between 30 and 10800),
  per_question_seconds integer check (per_question_seconds between 5 and 600),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (timing_mode = 'total' and total_seconds is not null and per_question_seconds is null)
    or
    (timing_mode = 'per_question' and total_seconds is null and per_question_seconds is not null)
  )
);

create unique index admin_vocab_assignment_time_templates_name_idx
  on public.admin_vocab_assignment_time_templates (created_by, lower(trim(name)));

create trigger class_groups_set_updated_at
before update on public.class_groups
for each row execute function private.set_updated_at();

create trigger admin_vocab_assignment_time_templates_set_updated_at
before update on public.admin_vocab_assignment_time_templates
for each row execute function private.set_updated_at();

alter table public.class_groups enable row level security;
alter table public.class_group_students enable row level security;
alter table public.admin_vocab_assignment_time_templates enable row level security;

revoke all on table public.class_groups from public, anon, authenticated;
revoke all on table public.class_group_students from public, anon, authenticated;
revoke all on table public.admin_vocab_assignment_time_templates
  from public, anon, authenticated;

grant select, insert, update, delete on table public.class_groups to authenticated;
grant select, insert, update, delete on table public.class_group_students to authenticated;
grant select, insert, update, delete
  on table public.admin_vocab_assignment_time_templates to authenticated;

create policy "active admins manage class groups"
on public.class_groups
for all
to authenticated
using ((select private.is_active_admin()))
with check ((select private.is_active_admin()));

create policy "active admins manage class group students"
on public.class_group_students
for all
to authenticated
using ((select private.is_active_admin()))
with check ((select private.is_active_admin()));

create policy "active admins manage own vocab time templates"
on public.admin_vocab_assignment_time_templates
for all
to authenticated
using (
  (select private.is_active_admin())
  and created_by = (select auth.uid())
)
with check (
  (select private.is_active_admin())
  and created_by = (select auth.uid())
);

create function private.create_bulk_vocab_assignments_v6(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  distinct_student_ids uuid[];
  locked_student_count integer;
  previous_result jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_batches is null
    or jsonb_typeof(p_batches) <> 'array'
    or jsonb_array_length(p_batches) not between 1 and 210
    or exists (
      select 1
      from jsonb_array_elements(p_batches) as input(item)
      where jsonb_typeof(
        coalesce(
          input.item -> 'allowed_collision_assignment_ids',
          '[]'::jsonb
        )
      ) <> 'array'
    )
  then
    raise exception 'invalid_bulk_assignment_series'
      using errcode = '22023';
  end if;

  select array_agg(student_id order by student_id)
  into distinct_student_ids
  from (
    select distinct (item ->> 'student_id')::uuid as student_id
    from jsonb_array_elements(p_batches) as input(item)
  ) as selected;

  perform student.id
  from public.students as student
  where student.id = any(distinct_student_ids)
    and student.status = 'active'
    and student.deleted_at is null
  order by student.id
  for update;

  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(distinct_student_ids)
    and student.status = 'active'
    and student.deleted_at is null;
  if locked_student_count <> cardinality(distinct_student_ids) then
    raise exception 'bulk_assignment_student_not_active'
      using errcode = '22023';
  end if;

  previous_result := private.get_bulk_vocab_series_result_v1(
    p_idempotency_key,
    p_request_sha256
  );
  if previous_result is not null then
    return previous_result;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    join public.assignment_students as link
      on link.student_id = (input.item ->> 'student_id')::uuid
     and link.cancelled_at is null
     and link.missed_at is null
    join public.assignments as assignment
      on assignment.id = link.assignment_id
     and assignment.deleted_at is null
    where (
      coalesce(assignment.available_from, link.assigned_at)
        at time zone 'Asia/Seoul'
    )::date = (
      (input.item ->> 'available_from')::timestamptz
        at time zone 'Asia/Seoul'
    )::date
      and (
        not exists (
          select 1
          from public.quiz_attempts as attempt
          where attempt.assignment_id = link.assignment_id
            and attempt.student_id = link.student_id
        )
        or exists (
          select 1
          from public.quiz_attempts as attempt
          where attempt.assignment_id = link.assignment_id
            and attempt.student_id = link.student_id
            and attempt.status = 'in_progress'
        )
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(
          coalesce(
            input.item -> 'allowed_collision_assignment_ids',
            '[]'::jsonb
          )
        ) as allowed(assignment_id)
        where allowed.assignment_id = assignment.id::text
      )
  ) then
    raise exception 'bulk_assignment_schedule_conflict'
      using errcode = '40001';
  end if;

  return private.create_bulk_vocab_assignments_v5(
    p_idempotency_key,
    p_request_sha256,
    p_batches
  );
end;
$$;

create function public.create_bulk_vocab_assignments_v6(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_bulk_vocab_assignments_v6(
    p_idempotency_key,
    p_request_sha256,
    p_batches
  );
$$;

revoke all on function private.create_bulk_vocab_assignments_v6(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_bulk_vocab_assignments_v6(
  uuid, text, jsonb
) to authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v6(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v6(
  uuid, text, jsonb
) to authenticated, service_role;
