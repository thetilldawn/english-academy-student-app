begin;

-- Student deletion must not depend on a global maintenance sweep. Lock the
-- exact student first, lock attempts before their queue rows, cancel the queue,
-- then finalize the already-locked expired attempts and reuse the established
-- v1 core. This keeps normal quiz completion's attempt -> series lock order
-- without emitting a transient attention event during deletion.
create function private.delete_student_v2(
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  student_deleted_at timestamptz;
  evaluation_at timestamptz := transaction_timestamp();
  series_row record;
  attempt_row record;
  base_result jsonb;
  cancelled_series_count integer := 0;
  cancelled_item_count integer := 0;
  expired_attempt_count integer := 0;
  abandoned_attempt_count integer := 0;
  changed_count integer := 0;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null then
    raise exception 'invalid_student_delete_input'
      using errcode = '22023';
  end if;

  select student.deleted_at
  into student_deleted_at
  from public.students as student
  where student.id = p_student_id
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if student_deleted_at is not null then
    return jsonb_build_object(
      'status', 'deleted',
      'studentId', p_student_id,
      'expiredAttemptCount', 0,
      'abandonedAttemptCount', 0,
      'cancelledSeriesCount', 0,
      'cancelledSeriesItemCount', 0
    );
  end if;

  perform attempt.id
  from public.quiz_attempts as attempt
  where attempt.student_id = p_student_id
    and attempt.status = 'in_progress'
  order by attempt.id
  for update;

  for series_row in
    select series.id
    from private.vocab_assignment_series as series
    where series.student_id = p_student_id
      and series.status in ('active', 'attention')
    order by series.id
    for update
  loop
    perform item.id
    from private.vocab_assignment_series_items as item
    where item.series_id = series_row.id
      and item.status in ('queued', 'ready', 'assigned', 'attention')
    order by item.sequence_number, item.id
    for update;

    update private.vocab_assignment_series_items
    set
      status = 'cancelled',
      attention_reason = null,
      cancelled_at = evaluation_at,
      updated_at = evaluation_at
    where series_id = series_row.id
      and status in ('queued', 'ready', 'assigned', 'attention');
    get diagnostics changed_count = row_count;
    cancelled_item_count := cancelled_item_count + changed_count;

    update private.vocab_assignment_series
    set
      status = 'cancelled',
      attention_reason = null,
      cancelled_at = evaluation_at,
      updated_at = evaluation_at
    where id = series_row.id
      and status in ('active', 'attention');
    get diagnostics changed_count = row_count;
    if changed_count = 1 then
      cancelled_series_count := cancelled_series_count + 1;
      insert into private.vocab_assignment_series_events (
        series_id,
        event_kind,
        details,
        occurred_at
      ) values (
        series_row.id,
        'series.cancelled',
        jsonb_build_object('reason', 'student_deleted'),
        evaluation_at
      );
    end if;
  end loop;

  for attempt_row in
    select attempt.id
    from public.quiz_attempts as attempt
    where attempt.student_id = p_student_id
      and attempt.status = 'in_progress'
      and attempt.phase <> 'review'
      and attempt.deadline_at <= evaluation_at
    order by attempt.id
    for update
  loop
    perform private.finalize_expired_quiz_attempt_at_v2(
      p_student_id,
      attempt_row.id,
      evaluation_at
    );
    expired_attempt_count := expired_attempt_count + 1;
  end loop;

  select count(*)::integer
  into abandoned_attempt_count
  from public.quiz_attempts as attempt
  where attempt.student_id = p_student_id
    and attempt.status = 'in_progress';

  base_result := private.delete_student_v1(p_student_id);

  delete from private.student_app_maintenance_retry_state as retry
  where retry.student_id = p_student_id;

  return base_result || jsonb_build_object(
    'expiredAttemptCount', expired_attempt_count,
    'abandonedAttemptCount', abandoned_attempt_count,
    'cancelledSeriesCount', cancelled_series_count,
    'cancelledSeriesItemCount', cancelled_item_count
  );
end;
$$;

create function public.delete_student_v2(
  p_student_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.delete_student_v2(p_student_id);
$$;

-- Assignment deletion keeps the existing "live attempt blocks deletion"
-- contract, but finalizes already-expired attempts for this assignment only.
create function private.delete_assignment_v2(
  p_assignment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  evaluation_at timestamptz := transaction_timestamp();
  attempt_row record;
  base_result jsonb;
  expired_attempt_count integer := 0;
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

  for attempt_row in
    select attempt.student_id, attempt.id
    from public.quiz_attempts as attempt
    where attempt.assignment_id = p_assignment_id
      and attempt.status = 'in_progress'
      and attempt.phase <> 'review'
      and attempt.deadline_at <= evaluation_at
    order by attempt.student_id, attempt.id
    for update
  loop
    perform private.finalize_expired_quiz_attempt_at_v2(
      attempt_row.student_id,
      attempt_row.id,
      evaluation_at
    );
    expired_attempt_count := expired_attempt_count + 1;
  end loop;

  base_result := private.delete_assignment_v1(
    p_assignment_id,
    p_reason
  );
  return base_result || jsonb_build_object(
    'expiredAttemptCount', expired_attempt_count
  );
end;
$$;

create function public.delete_assignment_v2(
  p_assignment_id uuid,
  p_reason text default '관리자 삭제'
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.delete_assignment_v2(
    p_assignment_id,
    p_reason
  );
$$;

revoke all on function private.delete_student_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_student_v2(uuid)
  from public, anon, service_role;
grant execute on function public.delete_student_v2(uuid)
  to authenticated;

revoke all on function private.delete_assignment_v2(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_assignment_v2(uuid, text)
  from public, anon, service_role;
grant execute on function public.delete_assignment_v2(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
