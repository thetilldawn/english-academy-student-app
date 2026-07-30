begin;

-- Initial-stage wrong answers must become visible as soon as the attempt enters
-- the explicit review phase. The terminal-status trigger remains responsible
-- for retry-stage wrong answers. The unique key on
-- (quiz_question_id, wrong_stage) keeps both paths idempotent.
create function private.record_initial_wrong_events_when_review_starts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_wrong_events_for_attempt(
    new.id,
    new.student_id,
    coalesce(new.initial_completed_at, clock_timestamp())
  );
  return new;
end;
$$;

create trigger quiz_attempts_record_initial_wrong_events
after update of phase on public.quiz_attempts
for each row
when (
  old.phase = 'initial'
  and new.phase = 'review'
  and new.status = 'in_progress'
)
execute function private.record_initial_wrong_events_when_review_starts();

-- Repair attempts that had already reached review before this trigger existed.
do $$
declare
  attempt_row record;
begin
  for attempt_row in
    select
      attempt.id,
      attempt.student_id,
      attempt.initial_completed_at
    from public.quiz_attempts as attempt
    where attempt.status = 'in_progress'
      and attempt.phase = 'review'
      and attempt.initial_completed_at is not null
    order by attempt.id
  loop
    perform private.record_wrong_events_for_attempt(
      attempt_row.id,
      attempt_row.student_id,
      attempt_row.initial_completed_at
    );
  end loop;
end;
$$;

create function private.cancel_student_vocab_review_assignment_draft(
  p_student_id uuid,
  p_review_draft_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_status text;
  released_queue_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null or p_review_draft_id is null then
    raise exception 'invalid_review_draft_cancel_input'
      using errcode = '22023';
  end if;

  -- Match all supported review-draft producers and consumers:
  -- student -> reserved queue rows -> draft.
  perform 1
  from public.students as student
  where student.id = p_student_id
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = p_review_draft_id
  order by queue.id
  for update;

  select draft.status
  into draft_status
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = p_review_draft_id
    and draft.student_id = p_student_id
  for update;

  if not found then
    raise exception 'review_assignment_draft_not_found'
      using errcode = 'P0002';
  end if;

  if draft_status = 'cancelled' then
    return 'cancelled';
  end if;

  if draft_status <> 'pending' then
    raise exception 'review_assignment_draft_unavailable'
      using errcode = '40001';
  end if;

  update public.student_vocab_review_assignment_drafts as draft
  set
    status = 'cancelled',
    cancelled_at = clock_timestamp()
  where draft.id = p_review_draft_id
    and draft.student_id = p_student_id
    and draft.status = 'pending';

  if not found then
    raise exception 'review_assignment_draft_cancel_race'
      using errcode = '40001';
  end if;

  update public.student_vocab_review_queue as queue
  set
    reserved_review_draft_id = null,
    reserved_at = null
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = p_review_draft_id;

  get diagnostics released_queue_count = row_count;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'student.review_assignment_draft.cancelled',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'draftId', p_review_draft_id,
      'releasedQueueCount', released_queue_count,
      'queueDisposition', 'pending'
    )
  );

  return 'cancelled';
end;
$$;

create function public.cancel_student_vocab_review_assignment_draft(
  p_student_id uuid,
  p_review_draft_id uuid
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_student_vocab_review_assignment_draft(
    p_student_id,
    p_review_draft_id
  );
$$;

revoke all on function
  private.record_initial_wrong_events_when_review_starts()
  from public, anon, authenticated;
revoke all on function
  private.cancel_student_vocab_review_assignment_draft(uuid, uuid)
  from public, anon, authenticated;
revoke all on function
  public.cancel_student_vocab_review_assignment_draft(uuid, uuid)
  from public, anon;

grant execute on function
  private.record_initial_wrong_events_when_review_starts()
  to service_role;
grant execute on function
  private.cancel_student_vocab_review_assignment_draft(uuid, uuid)
  to authenticated, service_role;
grant execute on function
  public.cancel_student_vocab_review_assignment_draft(uuid, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
