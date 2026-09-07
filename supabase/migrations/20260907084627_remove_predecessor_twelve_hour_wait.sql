-- APP-20260907-04: remove only the predecessor deadline + 12-hour condition.
-- First-attempt completion, the next assignment's own window and all auth guards stay.
-- No public assignment, attempt, answer, score, word or audio rows are changed.
begin;

create or replace function private.student_assignment_release_v1(
  p_student_id uuid, p_assignment_id uuid, p_at timestamptz
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target public.assignments%rowtype;
  current_item private.vocab_assignment_series_items%rowtype;
  previous_item private.vocab_assignment_series_items%rowtype;
  predecessor_id uuid;
  first_completed_at timestamptz;
  opens_at timestamptz;
  deferred_at timestamptz;
begin
  select a.* into target from public.assignments a
    join public.assignment_students r on r.assignment_id = a.id
    join public.students s on s.id = r.student_id
    where a.id = p_assignment_id and r.student_id = p_student_id
      and r.cancelled_at is null and r.assigned_at <= p_at and a.deleted_at is null
      and a.status in ('active','closed') and s.status = 'active' and s.deleted_at is null;
  if not found then
    return jsonb_build_object('state','unavailable','opensAt',null,'hasDeadline',false);
  end if;
  select i.* into current_item from private.vocab_assignment_series_items i
    join private.vocab_assignment_series s on s.id = i.series_id
    where i.assignment_id = p_assignment_id and s.student_id = p_student_id;
  if found then
    if current_item.status = 'cancelled' or exists (
      select 1 from private.vocab_assignment_series s
      where s.id = current_item.series_id and s.status = 'cancelled'
    ) then
      return jsonb_build_object('state','cancelled','opensAt',null,'hasDeadline',false);
    end if;
    if current_item.status = 'deferred' then
      return jsonb_build_object('state','held','opensAt',null,'hasDeadline',false);
    end if;
    if current_item.sequence_number > 1 then
      select i.* into previous_item from private.vocab_assignment_series_items i
        where i.series_id = current_item.series_id and i.sequence_number = current_item.sequence_number - 1;
      if not found then
        return jsonb_build_object('state','schedule_conflict','opensAt',null,'hasDeadline',false);
      end if;
      if previous_item.status <> 'deferred' then
        predecessor_id := previous_item.assignment_id;
        if predecessor_id is null then
          if target.available_until <= p_at then
            return jsonb_build_object('state','schedule_conflict','opensAt',null,'hasDeadline',false);
          end if;
          return jsonb_build_object('state','waiting_initial','opensAt',null,'hasDeadline',false);
        end if;
      else
        deferred_at := previous_item.deferred_at;
      end if;
    else
      return jsonb_build_object('state','unrestricted','opensAt',null,'hasDeadline',false);
    end if;
  else
    select l.previous_assignment_id into predecessor_id
      from private.assignment_release_links_v1 l
      where l.assignment_id = p_assignment_id and l.student_id = p_student_id;
    if not found then
      return jsonb_build_object('state','unrestricted','opensAt',null,'hasDeadline',false);
    end if;
  end if;
  opens_at := greatest(target.available_from, deferred_at);
  if predecessor_id is not null then
    select min(a.initial_completed_at) into first_completed_at from public.quiz_attempts a
      where a.assignment_id = predecessor_id and a.student_id = p_student_id
        and a.initial_completed_at <= p_at;
    if first_completed_at is null then
      if target.available_until <= p_at then
        return jsonb_build_object('state','schedule_conflict','opensAt',null,'hasDeadline',false);
      end if;
      return jsonb_build_object('state','waiting_initial','opensAt',null,'hasDeadline',false);
    end if;
    opens_at := greatest(opens_at, first_completed_at);
  end if;
  if target.available_until is not null
    and opens_at >= target.available_until then
    return jsonb_build_object('state','schedule_conflict','opensAt',null,'hasDeadline',false);
  end if;
  return jsonb_build_object(
    'state', case when opens_at > p_at then 'waiting_time' else 'open' end,
    'opensAt', opens_at, 'hasDeadline', false);
end;
$$;

create or replace function private.ready_next_vocab_assignment_item_v1(
  p_series_id uuid, p_after_sequence integer, p_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  next_item private.vocab_assignment_series_items%rowtype;
  earliest_at timestamptz;
  has_deferred boolean;
  next_state text;
begin
  select * into next_item from private.vocab_assignment_series_items
    where series_id = p_series_id and status = 'queued' and sequence_number > p_after_sequence
    order by sequence_number limit 1 for update;
  if not found then
    select exists(select 1 from private.vocab_assignment_series_items
      where series_id = p_series_id and status = 'deferred') into has_deferred;
    update private.vocab_assignment_series
      set status = case when has_deferred then 'deferred' else 'completed' end,
        completed_at = case when has_deferred then null else p_at end,
        cancelled_at = null, attention_reason = null, updated_at = clock_timestamp()
      where id = p_series_id;
    if not has_deferred then
      insert into private.vocab_assignment_series_events(series_id,event_kind,details)
        values(p_series_id,'series.completed','{}');
    end if;
    return;
  end if;
  earliest_at := greatest(next_item.effective_available_from, p_at);
  next_state := case when next_item.effective_available_until <= greatest(earliest_at, clock_timestamp())
    then 'attention' else 'ready' end;
  update private.vocab_assignment_series_items
    set status = next_state,
      attention_reason = case when next_state = 'attention' then 'release_schedule_conflict' end,
      updated_at = clock_timestamp()
    where id = next_item.id;
  update private.vocab_assignment_series
    set status = case when next_state = 'attention' then 'attention' else 'active' end,
      attention_reason = case when next_state = 'attention' then 'release_schedule_conflict' end,
      updated_at = clock_timestamp()
    where id = p_series_id;
  insert into private.vocab_assignment_series_events(series_id,item_id,event_kind,details)
    values(p_series_id,next_item.id,
      case when next_state = 'attention' then 'session.attention' else 'session.ready' end,
      jsonb_build_object('sequenceNumber',next_item.sequence_number,'scheduleShifted',false,
        'reason',case when next_state = 'attention' then 'release_schedule_conflict' end));
end;
$$;

revoke all on function private.student_assignment_release_v1(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.student_assignment_release_v1(uuid,uuid,timestamptz) to service_role;
revoke all on function private.ready_next_vocab_assignment_item_v1(uuid,integer,timestamptz)
  from public, anon, authenticated, service_role;

-- Lock in the same order as student deletion, first-completion and queue workers.
-- NOWAIT aborts the transaction instead of waiting behind a live student action.
do $repair$
declare
  candidate record;
  checked_at timestamptz;
  old_opening timestamptz;
  new_opening timestamptz;
  changed integer;
  candidate_series_ids uuid[];
  candidate_student_ids uuid[];
begin
  -- Freeze the candidate IDs once. Later READ COMMITTED snapshots must never
  -- admit a newly-conflicting series whose student/series lock was not taken.
  select coalesce(array_agg(distinct series.id), '{}'::uuid[]),
    coalesce(array_agg(distinct series.student_id), '{}'::uuid[])
    into candidate_series_ids, candidate_student_ids
    from private.vocab_assignment_series series
    join private.vocab_assignment_series_items item on item.series_id = series.id
    where series.status = 'attention' and series.attention_reason = 'release_schedule_conflict'
      and item.status = 'attention' and item.attention_reason = 'release_schedule_conflict'
      and item.assignment_id is null and item.materialized_at is null;
  perform student.id from public.students student
    where student.id = any(candidate_student_ids)
    order by student.id for update of student nowait;
  perform series.id from private.vocab_assignment_series series
    where series.id = any(candidate_series_ids) and series.student_id = any(candidate_student_ids)
    order by series.student_id, series.id for update of series nowait;
  perform item.id from private.vocab_assignment_series_items item
    join private.vocab_assignment_series series on series.id = item.series_id
    where series.id = any(candidate_series_ids) and series.student_id = any(candidate_student_ids)
    order by series.student_id, series.id, item.sequence_number for update of item nowait;

  checked_at := clock_timestamp();
  -- Re-read every predicate after locking. Do not infer completion from a label.
  for candidate in
    select item.id, item.series_id, item.sequence_number,
      item.effective_available_from, item.effective_available_until,
      previous.assignment_id as previous_assignment_id,
      attempt.id as previous_attempt_id, attempt.initial_completed_at,
      assignment.available_until as previous_deadline
    from private.vocab_assignment_series_items item
    join private.vocab_assignment_series series on series.id = item.series_id
    join public.students student on student.id = series.student_id
    join private.vocab_assignment_series_items previous
      on previous.series_id = item.series_id and previous.sequence_number = item.sequence_number - 1
    join public.quiz_attempts attempt
      on attempt.id = previous.completed_attempt_id and attempt.assignment_id = previous.assignment_id
      and attempt.student_id = series.student_id
    join public.assignments assignment on assignment.id = previous.assignment_id
    join public.assignment_students recipient
      on recipient.assignment_id = assignment.id and recipient.student_id = series.student_id
    where series.id = any(candidate_series_ids) and series.student_id = any(candidate_student_ids)
      and series.status = 'attention' and series.attention_reason = 'release_schedule_conflict'
      and series.completed_at is null and series.cancelled_at is null
      and student.status = 'active' and student.deleted_at is null
      and item.status = 'attention' and item.attention_reason = 'release_schedule_conflict'
      and item.assignment_id is null and item.materialized_at is null
      and item.completed_at is null and item.completed_attempt_id is null
      and item.cancelled_at is null and item.deferred_at is null
      and previous.status = 'completed' and previous.completed_at is not null
      and previous.cancelled_at is null and previous.deferred_at is null
      and attempt.initial_completed_at is not null and attempt.initial_completed_at <= checked_at
      and assignment.deleted_at is null and assignment.status in ('active','closed')
      and recipient.cancelled_at is null and assignment.available_until is not null
      and item.effective_available_until > checked_at
      and not exists (select 1 from private.vocab_assignment_series_items other
        where other.series_id = series.id and other.id <> item.id
          and (other.status in ('ready','assigned','attention')
            or (other.sequence_number < item.sequence_number and other.status <> 'completed')))
    order by series.student_id, series.id, item.sequence_number
  loop
    if candidate.effective_available_until <= clock_timestamp() then continue; end if;
    new_opening := greatest(candidate.effective_available_from, candidate.initial_completed_at);
    old_opening := greatest(new_opening, candidate.previous_deadline + interval '12 hours');
    if old_opening < candidate.effective_available_until
      or new_opening >= candidate.effective_available_until then continue; end if;

    update private.vocab_assignment_series_items
      set status = 'ready', attention_reason = null, updated_at = checked_at
      where id = candidate.id and status = 'attention' and attention_reason = 'release_schedule_conflict'
        and assignment_id is null and materialized_at is null;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'predecessor_wait_repair_target_changed'; end if;
    update private.vocab_assignment_series
      set status = 'active', attention_reason = null, updated_at = checked_at
      where id = candidate.series_id and status = 'attention' and attention_reason = 'release_schedule_conflict';
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'predecessor_wait_repair_series_changed'; end if;
    insert into private.vocab_assignment_series_events(series_id,item_id,event_kind,details)
      values(candidate.series_id,candidate.id,'session.ready',jsonb_build_object(
        'reason','predecessor_wait_removed','workOrder','APP-20260907-04',
        'sequenceNumber',candidate.sequence_number,'scheduleShifted',false,
        'previousAssignmentId',candidate.previous_assignment_id,'previousAttemptId',candidate.previous_attempt_id,
        'oldOpening',old_opening,'newOpening',new_opening));
  end loop;
end;
$repair$;

commit;
