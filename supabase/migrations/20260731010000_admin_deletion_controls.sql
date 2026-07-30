begin;

alter table public.students
  add column deleted_at timestamptz,
  add column deleted_by uuid
    references auth.users(id)
    on delete restrict;

alter table public.assignments
  add column deleted_at timestamptz,
  add column deleted_by uuid
    references auth.users(id)
    on delete restrict,
  add column deletion_reason text
    check (
      deletion_reason is null
      or char_length(trim(deletion_reason)) between 1 and 500
    );

alter table public.students
  add constraint students_deletion_state_check check (
    (
      deleted_at is null
      and deleted_by is null
    )
    or (
      deleted_at is not null
      and deleted_by is not null
      and status = 'blocked'
    )
  );

alter table public.assignments
  add constraint assignments_deletion_state_check check (
    (
      deleted_at is null
      and deleted_by is null
      and deletion_reason is null
    )
    or (
      deleted_at is not null
      and deleted_by is not null
      and deletion_reason is not null
      and status = 'closed'
    )
  );

create index students_deleted_by_idx
  on public.students (deleted_by)
  where deleted_by is not null;
create index students_visible_name_idx
  on public.students (display_name, id)
  where deleted_at is null;
create index assignments_deleted_by_idx
  on public.assignments (deleted_by)
  where deleted_by is not null;
create index assignments_visible_created_idx
  on public.assignments (created_at desc, id)
  where deleted_at is null;

create table public.admin_history_hidden_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  assignment_id uuid not null
    references public.assignments(id)
    on delete restrict,
  student_id uuid not null
    references public.students(id)
    on delete restrict,
  attempt_id uuid
    references public.quiz_attempts(id)
    on delete restrict,
  hidden_by uuid not null
    references auth.users(id)
    on delete restrict,
  hidden_at timestamptz not null default clock_timestamp()
);

create unique index admin_history_hidden_attempt_idx
  on public.admin_history_hidden_entries (attempt_id)
  where attempt_id is not null;
create unique index admin_history_hidden_recipient_idx
  on public.admin_history_hidden_entries (assignment_id, student_id)
  where attempt_id is null;
create index admin_history_hidden_student_idx
  on public.admin_history_hidden_entries (student_id);
create index admin_history_hidden_by_idx
  on public.admin_history_hidden_entries (hidden_by);

alter table public.admin_history_hidden_entries
  enable row level security;

create policy "active admins read hidden history entries"
on public.admin_history_hidden_entries
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.admin_history_hidden_entries
  from public, anon, authenticated;
grant select on table public.admin_history_hidden_entries
  to authenticated;
grant all on table public.admin_history_hidden_entries
  to service_role;

create function private.prevent_deleted_student_reactivation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.deleted_at is not null and new is distinct from old
  then
    raise exception 'deleted_student_is_immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger students_prevent_deleted_reactivation
before update on public.students
for each row
execute function private.prevent_deleted_student_reactivation();

create function private.prevent_deleted_assignment_reactivation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.deleted_at is not null and new is distinct from old
  then
    raise exception 'deleted_assignment_is_immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger assignments_prevent_deleted_reactivation
before update on public.assignments
for each row
execute function private.prevent_deleted_assignment_reactivation();

revoke all on function private.prevent_deleted_student_reactivation()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_deleted_assignment_reactivation()
  from public, anon, authenticated, service_role;

create function private.reject_student_physical_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'student_physical_delete_forbidden'
    using errcode = '55000';
end;
$$;

create trigger students_reject_physical_delete
before delete on public.students
for each row
execute function private.reject_student_physical_delete();

create function private.reject_assignment_physical_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'assignment_physical_delete_forbidden'
    using errcode = '55000';
end;
$$;

create trigger assignments_reject_physical_delete
before delete on public.assignments
for each row
execute function private.reject_assignment_physical_delete();

revoke all on function private.reject_student_physical_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_assignment_physical_delete()
  from public, anon, authenticated, service_role;

create function private.reject_deleted_assignment_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_deleted_at timestamptz;
  assignment_deleted_at timestamptz;
begin
  select student.deleted_at
  into student_deleted_at
  from public.students as student
  where student.id = new.student_id
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if student_deleted_at is not null then
    raise exception 'student_deleted' using errcode = '22023';
  end if;

  select assignment.deleted_at
  into assignment_deleted_at
  from public.assignments as assignment
  where assignment.id = new.assignment_id
  for update;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if assignment_deleted_at is not null then
    raise exception 'assignment_deleted' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger assignment_students_reject_deleted_recipient
before insert or update on public.assignment_students
for each row
execute function private.reject_deleted_assignment_recipient();

revoke all on function private.reject_deleted_assignment_recipient()
  from public, anon, authenticated, service_role;

create or replace function private.reject_attempt_for_missed_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_deleted_at timestamptz;
  recorded_missed_at timestamptz;
  recorded_cancelled_at timestamptz;
  assignment_deadline timestamptz;
  assignment_deleted_at timestamptz;
begin
  select student.deleted_at
  into student_deleted_at
  from public.students as student
  where student.id = new.student_id
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if student_deleted_at is not null then
    raise exception 'student_deleted' using errcode = '22023';
  end if;

  select
    link.missed_at,
    link.cancelled_at,
    assignment.available_until,
    assignment.deleted_at
  into
    recorded_missed_at,
    recorded_cancelled_at,
    assignment_deadline,
    assignment_deleted_at
  from public.assignment_students as link
  join public.assignments as assignment
    on assignment.id = link.assignment_id
  where link.assignment_id = new.assignment_id
    and link.student_id = new.student_id
  for update of assignment, link;

  if not found then
    raise exception 'assignment_not_owned' using errcode = '42501';
  end if;
  if assignment_deleted_at is not null then
    raise exception 'assignment_deleted' using errcode = '22023';
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

create or replace function private.reject_assignment_student_history_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.missed_at is not null
    or old.cancelled_at is not null
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

revoke all on function private.reject_attempt_for_missed_assignment()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_assignment_student_history_delete()
  from public, anon, authenticated, service_role;

create function private.abandon_student_attempt_v1(
  p_student_id uuid,
  p_attempt_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  question_total integer;
  initial_correct integer;
  retry_correct integer;
  unresolved_wrong integer;
  initial_score_value numeric(5, 2);
  final_score_value numeric(5, 2);
  evaluation_time timestamptz := clock_timestamp();
begin
  select *
  into attempt_row
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if attempt_row.status <> 'in_progress' then
    return;
  end if;

  if attempt_row.phase = 'review' then
    update public.quiz_attempts
    set
      status = 'expired',
      phase = 'completed',
      completed_at = evaluation_time,
      final_score = initial_score,
      passed = false
    where id = p_attempt_id;
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where question.initial_is_correct is true
    )::integer,
    count(*) filter (
      where question.initial_is_correct is false
        and question.retry_is_correct is true
    )::integer
  into
    question_total,
    initial_correct,
    retry_correct
  from public.quiz_questions as question
  where question.attempt_id = p_attempt_id;

  if question_total <> attempt_row.question_count_snapshot then
    raise exception 'attempt_question_count_mismatch'
      using errcode = '23514';
  end if;

  unresolved_wrong :=
    question_total - initial_correct - retry_correct;
  initial_score_value := round(
    (initial_correct::numeric / question_total) * 100,
    2
  );
  final_score_value := round(
    (
      (initial_correct + retry_correct)::numeric
      / question_total
    ) * 100,
    2
  );

  update public.quiz_attempts
  set
    status = 'expired',
    phase = 'completed',
    completed_at = evaluation_time,
    initial_correct_count = initial_correct,
    retry_correct_count = retry_correct,
    unresolved_wrong_count = unresolved_wrong,
    initial_score = initial_score_value,
    final_score = final_score_value,
    passed = false,
    elapsed_seconds = greatest(
      0,
      floor(
        extract(epoch from (evaluation_time - attempt_row.started_at))
      )::integer
    )
  where id = p_attempt_id;
end;
$$;

revoke all on function private.abandon_student_attempt_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.delete_student_v1(
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_name text;
  student_deleted_at timestamptz;
  next_generation integer;
  deletion_time timestamptz := clock_timestamp();
  recipient record;
  active_attempt record;
  abandoned_attempt_count integer := 0;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null then
    raise exception 'invalid_student_delete_input'
      using errcode = '22023';
  end if;

  select
    student.display_name,
    student.deleted_at,
    student.code_generation + 1
  into
    student_name,
    student_deleted_at,
    next_generation
  from public.students as student
  where student.id = p_student_id
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if student_deleted_at is not null then
    return jsonb_build_object(
      'status', 'deleted',
      'studentId', p_student_id
    );
  end if;

  for active_attempt in
    select attempt.id
    from public.quiz_attempts as attempt
    where attempt.student_id = p_student_id
      and attempt.status = 'in_progress'
    order by attempt.id
    for update
  loop
    perform private.abandon_student_attempt_v1(
      p_student_id,
      active_attempt.id
    );
    abandoned_attempt_count := abandoned_attempt_count + 1;
  end loop;

  for recipient in
    select link.assignment_id
    from public.assignment_students as link
    where link.student_id = p_student_id
      and link.cancelled_at is null
      and link.missed_at is null
    order by link.assignment_id
    for update
  loop
    if not exists (
      select 1
      from public.quiz_attempts as attempt
      where attempt.assignment_id = recipient.assignment_id
        and attempt.student_id = p_student_id
    ) then
      perform private.cancel_student_assignment_v1(
        recipient.assignment_id,
        p_student_id,
        '학생 삭제'
      );
    end if;
  end loop;

  update public.student_vocab_review_queue
  set
    reserved_review_draft_id = null,
    reserved_at = null
  where student_id = p_student_id
    and status = 'pending'
    and reserved_review_draft_id is not null;

  update public.student_vocab_review_assignment_drafts
  set
    status = 'cancelled',
    cancelled_at = coalesce(cancelled_at, deletion_time)
  where student_id = p_student_id
    and status = 'pending';

  update public.students
  set
    status = 'blocked',
    code_generation = next_generation,
    deleted_at = deletion_time,
    deleted_by = (select auth.uid())
  where id = p_student_id;

  delete from public.student_codes
  where student_id = p_student_id;

  update public.student_sessions
  set
    revoked_at = coalesce(revoked_at, deletion_time),
    revoke_reason = coalesce(revoke_reason, 'student_deleted')
  where student_id = p_student_id
    and revoked_at is null;

  update public.assignments as assignment
  set status = 'closed'
  where assignment.id in (
      select link.assignment_id
      from public.assignment_students as link
      where link.student_id = p_student_id
    )
    and not exists (
      select 1
      from public.assignment_students as active_link
      join public.students as active_student
        on active_student.id = active_link.student_id
      where active_link.assignment_id = assignment.id
        and active_link.cancelled_at is null
        and active_link.missed_at is null
        and active_student.deleted_at is null
    );

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'student.deleted',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'deletedAt', deletion_time,
      'displayNameSnapshot', student_name,
      'abandonedAttemptCount', abandoned_attempt_count
    )
  );

  return jsonb_build_object(
    'status', 'deleted',
    'studentId', p_student_id
  );
end;
$$;

create function public.delete_student_v1(
  p_student_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.delete_student_v1(p_student_id);
$$;

create function private.delete_assignment_v1(
  p_assignment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_title text;
  assignment_deleted_at timestamptz;
  deletion_time timestamptz := clock_timestamp();
  recipient record;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_assignment_id is null
    or p_reason is null
    or char_length(trim(p_reason)) not between 1 and 500
  then
    raise exception 'invalid_assignment_delete_input'
      using errcode = '22023';
  end if;

  perform 1
  from public.assignments as assignment
  where assignment.id = p_assignment_id;
  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;

  perform student.id
  from public.assignment_students as link
  join public.students as student
    on student.id = link.student_id
  where link.assignment_id = p_assignment_id
  order by student.id
  for update of student;

  select assignment.title, assignment.deleted_at
  into assignment_title, assignment_deleted_at
  from public.assignments as assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if assignment_deleted_at is not null then
    return jsonb_build_object(
      'status', 'deleted',
      'assignmentId', p_assignment_id
    );
  end if;
  if exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.assignment_id = p_assignment_id
      and attempt.status = 'in_progress'
  ) then
    raise exception 'assignment_has_in_progress_attempt'
      using errcode = '55000';
  end if;

  for recipient in
    select link.student_id
    from public.assignment_students as link
    where link.assignment_id = p_assignment_id
      and link.cancelled_at is null
      and link.missed_at is null
    order by link.student_id
    for update
  loop
    if not exists (
      select 1
      from public.quiz_attempts as attempt
      where attempt.assignment_id = p_assignment_id
        and attempt.student_id = recipient.student_id
    ) then
      perform private.cancel_student_assignment_v1(
        p_assignment_id,
        recipient.student_id,
        '시험 삭제'
      );
    end if;
  end loop;

  update public.assignments
  set
    status = 'closed',
    deleted_at = deletion_time,
    deleted_by = (select auth.uid()),
    deletion_reason = trim(p_reason)
  where id = p_assignment_id;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.deleted',
    (select auth.uid()),
    jsonb_build_object(
      'assignmentId', p_assignment_id,
      'deletedAt', deletion_time,
      'reason', trim(p_reason),
      'titleSnapshot', assignment_title
    )
  );

  return jsonb_build_object(
    'status', 'deleted',
    'assignmentId', p_assignment_id
  );
end;
$$;

create function public.delete_assignment_v1(
  p_assignment_id uuid,
  p_reason text default '관리자 삭제'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.delete_assignment_v1(
    p_assignment_id,
    p_reason
  );
$$;

create function private.hide_admin_history_entry_v1(
  p_assignment_id uuid,
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_assignment_id uuid;
  resolved_student_id uuid;
  inserted_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_assignment_id is null or p_student_id is null then
    raise exception 'invalid_history_delete_input'
      using errcode = '22023';
  end if;

  if p_attempt_id is not null then
    select attempt.assignment_id, attempt.student_id
    into resolved_assignment_id, resolved_student_id
    from public.quiz_attempts as attempt
    where attempt.id = p_attempt_id
    for update;

    if not found
      or resolved_assignment_id <> p_assignment_id
      or resolved_student_id <> p_student_id
    then
      raise exception 'history_entry_not_found'
        using errcode = 'P0002';
    end if;
  else
    perform 1
    from public.assignment_students as link
    where link.assignment_id = p_assignment_id
      and link.student_id = p_student_id
    for update;
    if not found then
      raise exception 'history_entry_not_found'
        using errcode = 'P0002';
    end if;
    if exists (
      select 1
      from public.quiz_attempts as attempt
      where attempt.assignment_id = p_assignment_id
        and attempt.student_id = p_student_id
    ) then
      raise exception 'history_entry_stale'
        using errcode = '55000';
    end if;
  end if;

  insert into public.admin_history_hidden_entries (
    assignment_id,
    student_id,
    attempt_id,
    hidden_by
  )
  values (
    p_assignment_id,
    p_student_id,
    p_attempt_id,
    (select auth.uid())
  )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    insert into public.audit_events (
      event_type,
      actor_admin_id,
      student_id,
      details
    )
    values (
      'admin.history.hidden',
      (select auth.uid()),
      p_student_id,
      jsonb_build_object(
        'assignmentId', p_assignment_id,
        'attemptId', p_attempt_id
      )
    );
  end if;

  return jsonb_build_object(
    'status', 'hidden',
    'assignmentId', p_assignment_id,
    'studentId', p_student_id,
    'attemptId', p_attempt_id
  );
end;
$$;

create function public.hide_admin_history_entry_v1(
  p_assignment_id uuid,
  p_student_id uuid,
  p_attempt_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.hide_admin_history_entry_v1(
    p_assignment_id,
    p_student_id,
    p_attempt_id
  );
$$;

revoke all on function private.delete_student_v1(uuid)
  from public, anon;
revoke all on function public.delete_student_v1(uuid)
  from public, anon;
revoke all on function private.delete_assignment_v1(uuid, text)
  from public, anon;
revoke all on function public.delete_assignment_v1(uuid, text)
  from public, anon;
revoke all on function private.hide_admin_history_entry_v1(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.hide_admin_history_entry_v1(uuid, uuid, uuid)
  from public, anon;

grant execute on function private.delete_student_v1(uuid)
  to authenticated, service_role;
grant execute on function public.delete_student_v1(uuid)
  to authenticated, service_role;
grant execute on function private.delete_assignment_v1(uuid, text)
  to authenticated, service_role;
grant execute on function public.delete_assignment_v1(uuid, text)
  to authenticated, service_role;
grant execute on function private.hide_admin_history_entry_v1(uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.hide_admin_history_entry_v1(uuid, uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
