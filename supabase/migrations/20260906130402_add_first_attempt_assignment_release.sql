begin;
-- Bounded deployment locks: a busy classroom must not wait indefinitely.
set local lock_timeout = '3s';

-- APP-20260906-14. Stored request receipts, never titles or creation-time guesses.
create table private.assignment_release_links_v1 (
  assignment_id uuid not null,
  student_id uuid not null,
  request_id uuid not null references private.bulk_vocab_series_requests(idempotency_key),
  sequence_number integer not null check (sequence_number between 2 and 210),
  original_assignment_id uuid not null references public.assignments(id),
  previous_assignment_id uuid not null,
  primary key (assignment_id, student_id),
  unique (request_id, student_id, sequence_number),
  foreign key (assignment_id, student_id)
    references public.assignment_students(assignment_id, student_id) on delete cascade,
  foreign key (previous_assignment_id, student_id)
    references public.assignment_students(assignment_id, student_id) on delete cascade,
  check (assignment_id <> previous_assignment_id)
);
create index assignment_release_links_previous_idx
  on private.assignment_release_links_v1(previous_assignment_id, student_id);
alter table private.assignment_release_links_v1 enable row level security;
revoke all on private.assignment_release_links_v1 from public, anon, authenticated, service_role;

create function private.current_replacement_assignment_v1(p_assignment_id uuid, p_student_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  current_id uuid := p_assignment_id;
  next_ids uuid[];
  visited uuid[] := array[p_assignment_id];
begin
  loop
    select array_agg(distinct r.replacement_assignment_id) into next_ids
    from private.assignment_replacement_requests r
    where r.source_assignment_id = current_id and r.student_id = p_student_id
      and r.completed_at is not null and r.replacement_assignment_id is not null;
    if coalesce(cardinality(next_ids), 0) = 0 then return current_id; end if;
    if cardinality(next_ids) <> 1 or next_ids[1] = any(visited) or cardinality(visited) >= 210 then
      raise exception 'assignment_release_relationship_ambiguous' using errcode = '22023';
    end if;
    current_id := next_ids[1];
    visited := array_append(visited, current_id);
  end loop;
end;
$$;

create function private.register_assignment_release_links_v1(p_request_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  student_group record;
  receipt record;
  previous_id uuid;
  current_id uuid;
begin
  if p_result is null then return; end if;
  if jsonb_typeof(p_result) <> 'array' then
    raise exception 'assignment_release_receipt_invalid' using errcode = '22023';
  end if;
  for student_group in
    select (r.value->>'student_id')::uuid student_id, count(*) total,
      count(distinct (r.value->>'session_number')::integer) unique_sequences,
      min((r.value->>'session_number')::integer) first_sequence,
      max((r.value->>'session_number')::integer) last_sequence,
      count(distinct (r.value->>'assignment_id')::uuid) unique_assignments
    from jsonb_array_elements(p_result) r
    group by (r.value->>'student_id')::uuid having count(*) > 1
  loop
    if student_group.student_id is null or student_group.unique_sequences <> student_group.total
      or student_group.unique_assignments <> student_group.total
      or student_group.first_sequence <> 1 or student_group.last_sequence <> student_group.total then
      raise exception 'assignment_release_receipt_invalid' using errcode = '22023';
    end if;
    perform 1 from public.students where id = student_group.student_id for update;
    previous_id := null;
    for receipt in
      select (r.value->>'assignment_id')::uuid assignment_id,
        (r.value->>'session_number')::integer sequence_number
      from jsonb_array_elements(p_result) r
      where (r.value->>'student_id')::uuid = student_group.student_id
      order by (r.value->>'session_number')::integer
    loop
      current_id := private.current_replacement_assignment_v1(receipt.assignment_id, student_group.student_id);
      if not exists (select 1 from public.assignment_students
        where assignment_id = current_id and student_id = student_group.student_id) then
        raise exception 'assignment_release_recipient_missing' using errcode = '22023';
      end if;
      if previous_id is not null and not exists (
        select 1 from private.vocab_assignment_series_items where assignment_id = current_id
      ) then
        insert into private.assignment_release_links_v1
          (assignment_id, student_id, request_id, sequence_number, original_assignment_id, previous_assignment_id)
        values (current_id, student_group.student_id, p_request_id, receipt.sequence_number,
          receipt.assignment_id, previous_id)
        on conflict (assignment_id, student_id) do nothing;
        if not exists (select 1 from private.assignment_release_links_v1
          where assignment_id = current_id and student_id = student_group.student_id
            and request_id = p_request_id and sequence_number = receipt.sequence_number
            and previous_assignment_id = previous_id) then
          raise exception 'assignment_release_relationship_ambiguous' using errcode = '22023';
        end if;
      end if;
      previous_id := current_id;
    end loop;
  end loop;
end;
$$;

create function private.capture_assignment_release_receipt_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.register_assignment_release_links_v1(new.idempotency_key, new.result);
  return new;
end;
$$;
create trigger bulk_vocab_series_release_receipt
after insert or update of result on private.bulk_vocab_series_requests
for each row when (new.result is not null)
execute function private.capture_assignment_release_receipt_v1();

-- A separate terminal state: held work is neither passed nor deleted.
alter table private.vocab_assignment_series_items
  add column deferred_at timestamptz;
alter table private.vocab_assignment_series_items
  drop constraint vocab_assignment_series_items_status_check,
  drop constraint vocab_assignment_series_items_state_check;
alter table private.vocab_assignment_series_items
  add constraint vocab_assignment_series_items_status_check check (
    status in ('queued','ready','assigned','completed','attention','cancelled','deferred')
  ),
  add constraint vocab_assignment_series_items_state_check check (
    (status in ('queued','ready') and assignment_id is null and materialized_at is null
      and completed_at is null and cancelled_at is null and deferred_at is null)
    or (status = 'assigned' and assignment_id is not null and materialized_at is not null
      and completed_at is null and cancelled_at is null and deferred_at is null)
    or (status = 'completed' and assignment_id is not null and materialized_at is not null
      and completed_at is not null and cancelled_at is null and deferred_at is null)
    or (status = 'attention' and completed_at is null and cancelled_at is null and deferred_at is null)
    or (status = 'cancelled' and completed_at is null and cancelled_at is not null and deferred_at is null)
    or (status = 'deferred' and completed_at is null and cancelled_at is null and deferred_at is not null)
  );

create function private.student_assignment_release_v1(
  p_student_id uuid, p_assignment_id uuid, p_at timestamptz
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target public.assignments%rowtype;
  current_item private.vocab_assignment_series_items%rowtype;
  previous_item private.vocab_assignment_series_items%rowtype;
  predecessor_id uuid;
  predecessor_deadline timestamptz;
  first_completed_at timestamptz;
  opens_at timestamptz;
  deadline_condition boolean := false;
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
            return jsonb_build_object('state','schedule_conflict','opensAt',null,'hasDeadline',true);
          end if;
          return jsonb_build_object('state','waiting_initial','opensAt',null,'hasDeadline',true);
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
    select a.available_until into predecessor_deadline from public.assignments a where a.id = predecessor_id;
    deadline_condition := predecessor_deadline is not null;
    select min(a.initial_completed_at) into first_completed_at from public.quiz_attempts a
      where a.assignment_id = predecessor_id and a.student_id = p_student_id
        and a.initial_completed_at <= p_at;
    if first_completed_at is null then
      if target.available_until <= p_at then
        return jsonb_build_object('state','schedule_conflict','opensAt',null,'hasDeadline',deadline_condition);
      end if;
      return jsonb_build_object('state','waiting_initial','opensAt',null,'hasDeadline',deadline_condition);
    end if;
    opens_at := greatest(opens_at, first_completed_at,
      predecessor_deadline + interval '12 hours');
  end if;
  if target.available_until is not null
    and opens_at >= target.available_until then
    return jsonb_build_object('state','schedule_conflict','opensAt',null,'hasDeadline',deadline_condition);
  end if;
  return jsonb_build_object(
    'state', case when opens_at > p_at then 'waiting_time' else 'open' end,
    'opensAt', opens_at, 'hasDeadline', deadline_condition);
end;
$$;

create function private.guard_new_attempt_release_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare release_state text;
begin
  -- Same student lock order as assignment mutation/start and the queue worker.
  perform 1 from public.students where id = new.student_id for update;
  release_state := private.student_assignment_release_v1(new.student_id, new.assignment_id, clock_timestamp())->>'state';
  if release_state not in ('open','unrestricted') then
    raise exception 'assignment_release_%', release_state using errcode = '55000';
  end if;
  return new;
end;
$$;
-- Keep the existing ownership/deletion/missed errors and lock order first.
create trigger quiz_attempts_zz_guard_release
before insert on public.quiz_attempts
for each row execute function private.guard_new_attempt_release_v1();

revoke all on function private.current_replacement_assignment_v1(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.register_assignment_release_links_v1(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.capture_assignment_release_receipt_v1() from public, anon, authenticated, service_role;
revoke all on function private.student_assignment_release_v1(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.student_assignment_release_v1(uuid,uuid,timestamptz) to service_role;
revoke all on function private.guard_new_attempt_release_v1() from public, anon, authenticated, service_role;

alter table private.vocab_assignment_series
  drop constraint vocab_assignment_series_status_check,
  drop constraint vocab_assignment_series_terminal_state_check;
alter table private.vocab_assignment_series
  add constraint vocab_assignment_series_status_check
    check (status in ('active','attention','completed','cancelled','deferred')),
  add constraint vocab_assignment_series_terminal_state_check check (
    (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (status in ('active','attention','deferred') and completed_at is null and cancelled_at is null)
  );

-- Status-only automatic advancement must preserve both existing dates exactly.
-- Keep the established weekday normalization only for explicit date changes
-- (the administrator's confirmed re-assignment), not first-completion events.
create or replace function private.preserve_vocab_assignment_queue_planned_window_v1()
returns trigger language plpgsql set search_path = '' as $$
declare
  target_isodow integer;
  candidate_isodow integer;
  days_ahead integer;
  candidate_date date;
  candidate_from timestamptz;
  planned_duration interval;
begin
  if new.status <> 'ready' or (
    new.effective_available_from is not distinct from old.effective_available_from
    and new.effective_available_until is not distinct from old.effective_available_until
  ) then return new; end if;
  target_isodow := extract(isodow from new.planned_available_from at time zone 'Asia/Seoul')::integer;
  candidate_date := (new.effective_available_from at time zone 'Asia/Seoul')::date;
  candidate_isodow := extract(isodow from candidate_date)::integer;
  days_ahead := (target_isodow - candidate_isodow + 7) % 7;
  candidate_from := (
    candidate_date + days_ahead + (new.planned_available_from at time zone 'Asia/Seoul')::time
  ) at time zone 'Asia/Seoul';
  if candidate_from < new.effective_available_from then
    candidate_from := candidate_from + interval '7 days';
  end if;
  planned_duration := new.planned_available_until - new.planned_available_from;
  new.effective_available_from := candidate_from;
  new.effective_available_until := candidate_from + planned_duration;
  return new;
end;
$$;

create function private.ready_next_vocab_assignment_item_v1(
  p_series_id uuid, p_after_sequence integer, p_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  next_item private.vocab_assignment_series_items%rowtype;
  previous_item private.vocab_assignment_series_items%rowtype;
  earliest_at timestamptz;
  previous_deadline timestamptz;
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
  select * into previous_item from private.vocab_assignment_series_items
    where series_id = p_series_id and sequence_number = next_item.sequence_number - 1;
  earliest_at := greatest(next_item.effective_available_from, p_at);
  if previous_item.status <> 'deferred' then
    select available_until into previous_deadline from public.assignments
      where id = previous_item.assignment_id;
    earliest_at := greatest(earliest_at, previous_deadline + interval '12 hours');
  end if;
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


create or replace function private.advance_vocab_queue_first_attempt_v1(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  current_item private.vocab_assignment_series_items%rowtype;
  current_series private.vocab_assignment_series%rowtype;
begin
  select * into attempt_row from public.quiz_attempts where id = p_attempt_id;
  if not found then return; end if;
  select item.*
  into current_item
  from private.vocab_assignment_series_items as item
  join private.vocab_assignment_series as series on series.id = item.series_id
  where item.assignment_id = attempt_row.assignment_id
    and series.student_id = attempt_row.student_id;

  if not found then
    return;
  end if;

  select series.*
  into current_series
  from private.vocab_assignment_series as series
  where series.id = current_item.series_id
  for update;

  select item.*
  into current_item
  from private.vocab_assignment_series_items as item
  where item.id = current_item.id
  for update;

  if current_series.status not in ('active', 'attention')
    or (current_item.status <> 'assigned' and not (
      current_item.status = 'attention' and current_item.attention_reason = 'assignment_expired'
      and attempt_row.initial_completed_at is not null
    ))
  then
    return;
  end if;

  if attempt_row.initial_completed_at is null then
    if attempt_row.status <> 'expired' then return; end if;
    update private.vocab_assignment_series_items
    set status = 'attention',
        attention_reason = 'assignment_expired',
        updated_at = clock_timestamp()
    where id = current_item.id;
    update private.vocab_assignment_series
    set status = 'attention',
        attention_reason = 'assignment_expired',
        updated_at = clock_timestamp()
    where id = current_series.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      attempt_id,
      event_kind,
      details
    ) values (
      current_series.id,
      current_item.id,
      attempt_row.assignment_id,
      attempt_row.id,
      'session.attention',
      jsonb_build_object('reason', 'assignment_expired')
    );
    return;
  end if;

  update private.vocab_assignment_series_items
  set status = 'completed',
      completed_attempt_id = attempt_row.id,
      completed_at = attempt_row.initial_completed_at,
      attention_reason = null,
      updated_at = clock_timestamp()
  where id = current_item.id;

  insert into private.vocab_assignment_series_events (
    series_id,
    item_id,
    assignment_id,
    attempt_id,
    event_kind,
    details
  ) values (
    current_series.id,
    current_item.id,
    attempt_row.assignment_id,
    attempt_row.id,
    'session.completed',
    jsonb_build_object('sequenceNumber', current_item.sequence_number)
  );

  perform private.ready_next_vocab_assignment_item_v1(
    current_series.id, current_item.sequence_number, attempt_row.initial_completed_at
  );
  return;
end;
$$;

create or replace function private.resolve_vocab_assignment_queue_attention_v1(
  p_series_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  series_row private.vocab_assignment_series%rowtype;
  item_row private.vocab_assignment_series_items%rowtype;
  next_item private.vocab_assignment_series_items%rowtype;
  previous_assignment_id uuid;
  current_release_id uuid;
  shifted_from timestamptz;
  shifted_until timestamptz;
  resolved_at timestamptz := clock_timestamp();
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_series_id is null
    or p_action is null
    or p_action not in ('retry', 'skip', 'cancel')
  then
    raise exception 'invalid_vocab_queue_resolution'
      using errcode = '22023';
  end if;

  select series.*
  into series_row
  from private.vocab_assignment_series as series
  where series.id = p_series_id
  for update;
  if not found or series_row.status <> 'attention' then
    raise exception 'vocab_queue_attention_not_found'
      using errcode = 'P0002';
  end if;

  select item.*
  into item_row
  from private.vocab_assignment_series_items as item
  where item.series_id = series_row.id
    and item.status = 'attention'
  order by item.sequence_number
  limit 1
  for update;
  if not found then
    raise exception 'vocab_queue_attention_item_not_found'
      using errcode = 'P0002';
  end if;

  if p_action = 'cancel' then
    update private.vocab_assignment_series_items
    set status = 'cancelled',
        attention_reason = null,
        cancelled_at = resolved_at,
        updated_at = resolved_at
    where series_id = series_row.id
      and status not in ('completed', 'cancelled', 'deferred');
    update private.vocab_assignment_series
    set status = 'cancelled',
        attention_reason = null,
        completed_at = null,
        cancelled_at = resolved_at,
        updated_at = resolved_at
    where id = series_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      item_row.assignment_id,
      'series.cancelled',
      jsonb_build_object('action', p_action)
    );
  elsif p_action = 'retry' then
    previous_assignment_id := item_row.assignment_id;
    select next_window.available_from, next_window.available_until
    into shifted_from, shifted_until
    from private.next_vocab_assignment_queue_window_v1(
      series_row.recurrence_slots,
      resolved_at
    ) as next_window;

    select release.release_id
    into current_release_id
    from word_index.app_exam_use_release as release
    where release.dataset_id = series_row.dataset_id
      and release.status = 'active'
    order by release.created_at_utc desc, release.release_id
    limit 1;

    update private.vocab_assignment_series_items
    set status = 'ready',
        assignment_id = null,
        completed_attempt_id = null,
        effective_available_from = shifted_from,
        effective_available_until = shifted_until,
        attention_reason = null,
        materialized_at = null,
        completed_at = null,
        cancelled_at = null,
        updated_at = resolved_at
    where id = item_row.id;
    update private.vocab_assignment_series
    set actor_admin_id = (select auth.uid()),
        exam_use_release_id = current_release_id,
        status = 'active',
        attention_reason = null,
        updated_at = resolved_at
    where id = series_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      previous_assignment_id,
      'session.ready',
      jsonb_build_object(
        'action', p_action,
        'sequenceNumber', item_row.sequence_number,
        'scheduleShifted', true
      )
    );
  else
    update private.vocab_assignment_series_items
    set status = 'deferred', attention_reason = null,
        deferred_at = resolved_at, completed_at = null, cancelled_at = null,
        updated_at = resolved_at
    where id = item_row.id;
    insert into private.vocab_assignment_series_events (
      series_id, item_id, assignment_id, event_kind, details
    ) values (
      series_row.id, item_row.id, item_row.assignment_id, 'session.skipped',
      jsonb_build_object('action', p_action, 'sequenceNumber', item_row.sequence_number,
        'disposition', 'deferred')
    );
    update private.vocab_assignment_series
      set actor_admin_id = (select auth.uid())
      where id = series_row.id;
    perform private.ready_next_vocab_assignment_item_v1(
      series_row.id, item_row.sequence_number, resolved_at
    );
  end if;

  insert into public.audit_events (event_type, actor_admin_id, details)
  values (
    'assignment.vocab_completion_queue_resolved',
    (select auth.uid()),
    jsonb_build_object(
      'seriesId', series_row.id,
      'studentId', series_row.student_id,
      'action', p_action
    )
  );
  return jsonb_build_object(
    'series_id', series_row.id,
    'student_id', series_row.student_id,
    'action', p_action
  );
end;
$$;

create or replace function private.materialize_ready_vocab_assignment_queue_v2(
  p_student_id uuid,
  p_limit integer,
  p_evaluation_at timestamptz,
  p_only_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  series_row private.vocab_assignment_series%rowtype;
  item_row private.vocab_assignment_series_items%rowtype;
  created_assignment_id uuid;
  current_release_id uuid;
  failure_code text;
  failure_reason text;
  shifted_from timestamptz;
  shifted_until timestamptz;
  updated_assignment_count integer;
  results jsonb := '[]'::jsonb;
begin
  if p_student_id is null
    or p_limit is null
    or p_limit not between 1 and 50
    or p_evaluation_at is null
  then
    raise exception 'invalid_vocab_queue_materialize_request'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
    and student.deleted_at is null
  for update;
  if not found then
    return '[]'::jsonb;
  end if;

  for series_row in
    select series.*
    from private.vocab_assignment_series as series
    where series.student_id = p_student_id
      and series.status = 'active'
      and exists (
        select 1
        from private.vocab_assignment_series_items as item
        where item.series_id = series.id
          and item.status = 'ready'
          and (
            p_only_item_id is null
            or item.id = p_only_item_id
          )
      )
    order by series.created_at, series.id
    for update skip locked
    limit p_limit
  loop
    select item.*
    into item_row
    from private.vocab_assignment_series_items as item
    where item.series_id = series_row.id
      and item.status = 'ready'
      and (
        p_only_item_id is null
        or item.id = p_only_item_id
      )
    order by item.sequence_number
    limit 1
    for update;
    if not found then
      continue;
    end if;

    failure_code := null;
    if not exists (
      select 1
      from public.admin_profiles as admin
      where admin.user_id = series_row.actor_admin_id
        and admin.is_active
    ) then
      failure_reason := 'admin_inactive';
    else
      failure_reason := null;
    end if;

    select release.release_id
    into current_release_id
    from word_index.app_exam_use_release as release
    where release.dataset_id = series_row.dataset_id
      and release.status = 'active'
    order by release.created_at_utc desc, release.release_id
    limit 1
    for share;
    if failure_reason is null
      and current_release_id is distinct from series_row.exam_use_release_id
    then
      failure_reason := 'content_release_changed';
    end if;

    shifted_from := item_row.effective_available_from;
    shifted_until := item_row.effective_available_until;
    if failure_reason is null then
      begin
        update private.vocab_assignment_series_items
        set effective_available_from = shifted_from,
            effective_available_until = shifted_until
        where id = item_row.id
        returning effective_available_from, effective_available_until
        into shifted_from, shifted_until;

        if shifted_until <= p_evaluation_at then
          failure_reason := 'release_schedule_conflict';
        end if;
      exception when others then
        get stacked diagnostics failure_code = returned_sqlstate;
        failure_reason := 'schedule_invalid';
      end;
    end if;

    if false and failure_reason is null and exists (
      select 1
      from public.assignment_students as link
      join public.assignments as assignment on assignment.id = link.assignment_id
      where link.student_id = p_student_id
        and link.cancelled_at is null
        and link.missed_at is null
        and assignment.deleted_at is null
        and (
          coalesce(assignment.available_from, link.assigned_at)
            at time zone 'Asia/Seoul'
        )::date = (shifted_from at time zone 'Asia/Seoul')::date
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
              item_row.payload -> 'allowed_collision_assignment_ids',
              '[]'::jsonb
            )
          ) as allowed(assignment_id)
          where allowed.assignment_id = assignment.id::text
        )
    ) then
      failure_reason := 'schedule_conflict';
    end if;

    if failure_reason is null then
      begin
        created_assignment_id := private.create_assignment_with_delivery_system_v1(
          series_row.actor_admin_id,
          item_row.payload ->> 'title',
          series_row.dataset_id,
          item_row.unit_ids,
          item_row.question_count,
          (item_row.payload ->> 'english_to_korean_ratio')::smallint,
          (item_row.payload ->> 'time_limit_seconds')::integer,
          (item_row.payload ->> 'passing_score')::smallint,
          (item_row.payload ->> 'question_order_mode')::public.question_order_mode,
          shifted_until,
          array[p_student_id],
          item_row.payload ->> 'timing_mode',
          nullif(
            item_row.payload ->> 'question_time_limit_seconds',
            ''
          )::integer,
          item_row.payload -> 'questions'
        );
        perform private.align_assignment_unit_direction_v1(
          created_assignment_id,
          series_row.dataset_id,
          item_row.unit_ids
        );
        update public.assignments as assignment
        set available_from = shifted_from
        where assignment.id = created_assignment_id
          and assignment.available_until is not distinct from shifted_until;
        get diagnostics updated_assignment_count = row_count;
        if updated_assignment_count <> 1 then
          raise exception 'vocab_queue_schedule_write_failed'
            using errcode = '21000';
        end if;
      exception when others then
        get stacked diagnostics failure_code = returned_sqlstate;
        failure_reason := case
          when failure_code = '40001' then 'schedule_conflict'
          when failure_code in ('22023', '55000') then 'content_unavailable'
          else 'materialization_failed'
        end;
      end;
    end if;

    if failure_reason = 'materialization_failed' then
      update private.vocab_assignment_series_items
      set status = 'ready',
          attention_reason = failure_reason,
          updated_at = p_evaluation_at
      where id = item_row.id;
      update private.vocab_assignment_series
      set status = 'active',
          attention_reason = failure_reason,
          updated_at = p_evaluation_at
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        item_row.id,
        'session.materialization_failed',
        jsonb_build_object(
          'reason', failure_reason,
          'sqlstate', failure_code
        )
      );
      results := results || jsonb_build_array(jsonb_build_object(
        'series_id', series_row.id,
        'item_id', item_row.id,
        'assignment_id', null,
        'status', 'ready'
      ));
      continue;
    end if;

    if failure_reason is not null then
      update private.vocab_assignment_series_items
      set status = 'attention',
          attention_reason = failure_reason,
          updated_at = p_evaluation_at
      where id = item_row.id;
      update private.vocab_assignment_series
      set status = 'attention',
          attention_reason = failure_reason,
          updated_at = p_evaluation_at
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        item_row.id,
        'session.attention',
        jsonb_build_object(
          'reason', failure_reason,
          'sqlstate', failure_code
        )
      );
      results := results || jsonb_build_array(jsonb_build_object(
        'series_id', series_row.id,
        'item_id', item_row.id,
        'assignment_id', null,
        'status', 'attention'
      ));
      continue;
    end if;

    update private.vocab_assignment_series_items
    set status = 'assigned',
        assignment_id = created_assignment_id,
        materialized_at = p_evaluation_at,
        attention_reason = null,
        updated_at = p_evaluation_at
    where id = item_row.id;
    update private.vocab_assignment_series
    set status = 'active',
        attention_reason = null,
        updated_at = p_evaluation_at
    where id = series_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      created_assignment_id,
      'session.assigned',
      jsonb_build_object('sequenceNumber', item_row.sequence_number)
    );
    insert into public.audit_events (event_type, actor_admin_id, details)
    values (
      'assignment.vocab_completion_queue_materialized',
      series_row.actor_admin_id,
      jsonb_build_object(
        'seriesId', series_row.id,
        'itemId', item_row.id,
        'assignmentId', created_assignment_id,
        'studentId', p_student_id,
        'automated', true
      )
    );
    results := results || jsonb_build_array(jsonb_build_object(
      'series_id', series_row.id,
      'item_id', item_row.id,
      'assignment_id', created_assignment_id,
      'status', 'assigned'
    ));
  end loop;

  return results;
end;
$$;

create or replace function private.resolve_vocab_assignment_queue_attention_v2(
  p_series_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolution jsonb;
  student_id_value uuid;
  ready_item_id uuid;
  materialized jsonb;
  queue_summary jsonb;
  evaluation_at timestamptz;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_series_id is null
    or p_action is null
    or p_action not in ('retry', 'skip', 'cancel')
  then
    raise exception 'invalid_vocab_queue_resolution'
      using errcode = '22023';
  end if;

  select series.student_id
  into student_id_value
  from private.vocab_assignment_series as series
  where series.id = p_series_id;
  if not found then
    raise exception 'vocab_queue_attention_not_found'
      using errcode = 'P0002';
  end if;

  -- Match the student -> series -> item lock order used by student deletion.
  perform 1
  from public.students as student
  where student.id = student_id_value
  for update;
  if not found then
    raise exception 'vocab_queue_student_not_found'
      using errcode = 'P0002';
  end if;

  resolution := private.resolve_vocab_assignment_queue_attention_v1(
    p_series_id,
    p_action
  );

  if p_action in ('retry', 'skip') then
    select item.id
    into ready_item_id
    from private.vocab_assignment_series_items as item
    where item.series_id = p_series_id
      and item.status = 'ready'
    order by item.sequence_number, item.id
    limit 1
    for update;

    if ready_item_id is not null then
      evaluation_at := clock_timestamp();
      materialized := private.materialize_ready_vocab_assignment_queue_v2(
        (resolution ->> 'student_id')::uuid,
        1,
        evaluation_at,
        ready_item_id
      );
      if jsonb_array_length(materialized) <> 1
        or materialized -> 0 ->> 'series_id' <> p_series_id::text
        or materialized -> 0 ->> 'item_id' <> ready_item_id::text
        or materialized -> 0 ->> 'status' not in ('assigned', 'attention')
      then
        raise exception 'vocab_queue_materialization_failed'
          using errcode = '55000';
      end if;
    elsif p_action = 'retry' then
      raise exception 'vocab_queue_retry_item_missing'
        using errcode = '55000';
    end if;
  end if;

  queue_summary := private.get_vocab_assignment_queue_summary_v1(p_series_id);
  if queue_summary is null then
    raise exception 'vocab_queue_summary_missing' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'resolution', resolution,
    'queue', queue_summary
  );
end;
$$;

create or replace function public.list_vocab_assignment_queue_summaries_v1(
  p_include_closed boolean default false,
  p_student_id uuid default null,
  p_before_updated_at timestamptz default null,
  p_before_series_id uuid default null,
  p_limit integer default null
)
returns table (
  series_id uuid,
  student_id uuid,
  status text,
  attention_reason text,
  dataset_label text,
  range_label text,
  total_session_count integer,
  completed_session_count integer,
  remaining_session_count integer,
  total_question_count integer,
  remaining_question_count integer,
  current_assignment_id uuid,
  next_available_from timestamptz,
  next_available_until timestamptz,
  items jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (p_before_updated_at is null) <> (p_before_series_id is null) then
    raise exception 'invalid queue history cursor' using errcode = '22023';
  end if;
  if p_limit is not null and (p_limit < 1 or p_limit > 101) then
    raise exception 'invalid queue history limit' using errcode = '22023';
  end if;

  return query
  with selected_series as (
    select series.*
    from private.vocab_assignment_series as series
    where (p_student_id is null or series.student_id = p_student_id)
      and (p_include_closed or series.status in ('active', 'attention'))
      and (
        p_before_updated_at is null
        or (series.updated_at, series.id) <
          (p_before_updated_at, p_before_series_id)
      )
    order by series.updated_at desc, series.id desc
    limit p_limit
  )
  select
    series.id,
    series.student_id,
    series.status,
    series.attention_reason,
    series.dataset_label,
    series.range_label,
    count(item.id)::integer,
    count(item.id) filter (where item.status = 'completed')::integer,
    count(item.id) filter (
      where item.status not in ('completed', 'cancelled', 'deferred')
    )::integer,
    coalesce(sum(item.question_count), 0)::integer,
    coalesce(sum(item.question_count) filter (
      where item.status not in ('completed', 'cancelled', 'deferred')
    ), 0)::integer,
    (array_agg(item.assignment_id order by item.sequence_number) filter (
      where item.status = 'assigned'
    ))[1],
    (array_agg(item.effective_available_from order by item.sequence_number)
      filter (where item.status not in ('completed', 'cancelled', 'deferred')))[1],
    (array_agg(item.effective_available_until order by item.sequence_number)
      filter (where item.status not in ('completed', 'cancelled', 'deferred')))[1],
    jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'sequenceNumber', item.sequence_number,
        'status', item.status,
        'questionCount', item.question_count,
        'unitLabels', to_jsonb(item.unit_labels),
        'plannedAvailableFrom', item.planned_available_from,
        'plannedAvailableUntil', item.planned_available_until,
        'effectiveAvailableFrom', item.effective_available_from,
        'effectiveAvailableUntil', item.effective_available_until,
        'assignmentId', item.assignment_id,
        'attentionReason', item.attention_reason,
        'materializedAt', item.materialized_at,
        'completedAt', item.completed_at
      ) order by item.sequence_number
    ),
    series.created_at,
    series.updated_at
  from selected_series as series
  join private.vocab_assignment_series_items as item
    on item.series_id = series.id
  group by series.id, series.student_id, series.status,
    series.attention_reason, series.dataset_label, series.range_label,
    series.created_at, series.updated_at
  order by series.updated_at desc, series.id desc;
end;
$$;

create or replace function private.get_vocab_assignment_queue_summary_v1(
  p_series_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_series_id is null then
    raise exception 'invalid_vocab_queue_summary_request'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'series_id', series.id,
    'student_id', series.student_id,
    'status', series.status,
    'attention_reason', series.attention_reason,
    'dataset_label', series.dataset_label,
    'range_label', series.range_label,
    'total_session_count', count(item.id)::integer,
    'completed_session_count', count(item.id) filter (
      where item.status = 'completed'
    )::integer,
    'remaining_session_count', count(item.id) filter (
      where item.status not in ('completed', 'cancelled', 'deferred')
    )::integer,
    'total_question_count', coalesce(sum(item.question_count), 0)::integer,
    'remaining_question_count', coalesce(sum(item.question_count) filter (
      where item.status not in ('completed', 'cancelled', 'deferred')
    ), 0)::integer,
    'current_assignment_id', (array_agg(
      item.assignment_id order by item.sequence_number
    ) filter (where item.status = 'assigned'))[1],
    'next_available_from', (array_agg(
      item.effective_available_from order by item.sequence_number
    ) filter (where item.status not in ('completed', 'cancelled', 'deferred')))[1],
    'next_available_until', (array_agg(
      item.effective_available_until order by item.sequence_number
    ) filter (where item.status not in ('completed', 'cancelled', 'deferred')))[1],
    'items', jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'sequenceNumber', item.sequence_number,
        'status', item.status,
        'questionCount', item.question_count,
        'unitLabels', to_jsonb(item.unit_labels),
        'plannedAvailableFrom', item.planned_available_from,
        'plannedAvailableUntil', item.planned_available_until,
        'effectiveAvailableFrom', item.effective_available_from,
        'effectiveAvailableUntil', item.effective_available_until,
        'assignmentId', item.assignment_id,
        'attentionReason', item.attention_reason,
        'materializedAt', item.materialized_at,
        'completedAt', item.completed_at
      ) order by item.sequence_number
    ),
    'created_at', series.created_at,
    'updated_at', series.updated_at,
    'allocation_rule', series.allocation_rule,
    'recurrence_weekdays', case
      when series.split_basis = 'range_unit'
        and series.allocation_rule is not null
      then array(
        select distinct (slot.value ->> 'isodow')::integer
        from jsonb_array_elements(series.recurrence_slots) as slot(value)
        where coalesce(slot.value ->> 'isodow', '') ~ '^[1-7]$'
        order by (slot.value ->> 'isodow')::integer
      )
      else array[]::integer[]
    end
  )
  into result
  from private.vocab_assignment_series as series
  join private.vocab_assignment_series_items as item
    on item.series_id = series.id
  where series.id = p_series_id
  group by series.id;

  return result;
end;
$$;


create or replace function private.mark_vocab_assignment_queue_completed_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance_vocab_queue_first_attempt_v1(new.id);
  return new;
end;
$$;
drop trigger quiz_attempts_advance_vocab_assignment_queue on public.quiz_attempts;
create trigger quiz_attempts_advance_vocab_assignment_queue
after update of status, initial_completed_at on public.quiz_attempts
for each row when (
  (old.initial_completed_at is null and new.initial_completed_at is not null)
  or (old.status is distinct from new.status and new.status = 'expired')
)
execute function private.mark_vocab_assignment_queue_completed_v1();

create function public.resolve_vocab_assignment_queue_attention_v3(
  p_series_id uuid, p_action text, p_expected_item_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare student_id_value uuid; current_item_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expected_item_id is null then
    raise exception 'invalid_vocab_queue_resolution' using errcode = '22023';
  end if;
  select student_id into student_id_value from private.vocab_assignment_series where id = p_series_id;
  perform 1 from public.students where id = student_id_value for update;
  perform 1 from private.vocab_assignment_series where id = p_series_id for update;
  select id into current_item_id from private.vocab_assignment_series_items
    where series_id = p_series_id and status = 'attention'
    order by sequence_number limit 1 for update;
  if current_item_id is distinct from p_expected_item_id then
    raise exception 'vocab_queue_resolution_target_changed' using errcode = '40001';
  end if;
  return jsonb_set(
    private.resolve_vocab_assignment_queue_attention_v2(p_series_id,p_action),
    '{resolution,item_id}', to_jsonb(p_expected_item_id), true
  );
end;
$$;

create function private.relink_replaced_assignment_release_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.replacement_assignment_id is null or new.completed_at is null then return new; end if;
  perform 1 from public.students where id = new.student_id for update;
  update private.assignment_release_links_v1
    set assignment_id = new.replacement_assignment_id
    where assignment_id = new.source_assignment_id and student_id = new.student_id;
  update private.assignment_release_links_v1
    set previous_assignment_id = new.replacement_assignment_id
    where previous_assignment_id = new.source_assignment_id and student_id = new.student_id;
  return new;
end;
$$;
create trigger assignment_replacement_release_link
after insert or update of replacement_assignment_id on private.assignment_replacement_requests
for each row when (new.replacement_assignment_id is not null and new.completed_at is not null)
execute function private.relink_replaced_assignment_release_v1();

revoke all on function private.ready_next_vocab_assignment_item_v1(uuid,integer,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.advance_vocab_queue_first_attempt_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.relink_replaced_assignment_release_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_vocab_assignment_queue_attention_v3(uuid,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_vocab_assignment_queue_attention_v3(uuid,text,uuid) to authenticated;
-- An old tab cannot replay an unbound skip against the next attention item.
-- V3 calls private V2 inside the same transaction; no public fallback is needed.
revoke execute on function public.resolve_vocab_assignment_queue_attention_v1(uuid,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.resolve_vocab_assignment_queue_attention_v2(uuid,text)
  from public, anon, authenticated, service_role;

-- Preserve V1 for deployed old clients and safe code rollback.
create function private.student_dashboard_read_rows_v2(
  p_student_id uuid,
  p_snapshot_at timestamptz
)
returns table (
  assignment_id uuid,
  effective_at timestamptz,
  dashboard_section text,
  item jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recipient_base as materialized (
    select
      assignment.id as assignment_id,
      assignment.title,
      assignment.status::text as assignment_status,
      assignment.assignment_purpose,
      assignment.dataset_id,
      assignment.range_start,
      assignment.range_end,
      assignment.question_count,
      assignment.timing_mode,
      assignment.passing_score,
      assignment.retake_allowed,
      assignment.available_from,
      assignment.available_until,
      recipient.assigned_at,
      case
        when recipient.missed_at <= p_snapshot_at then recipient.missed_at
        else null
      end as missed_at,
      dataset.title as raw_dataset_title,
      dataset.edition as raw_dataset_edition,
      catalog.display_name as catalog_display_name,
      catalog.catalog_group,
      catalog.material_kind,
      catalog.grade_code as catalog_grade_code,
      catalog.publisher as catalog_publisher,
      catalog.series_title as catalog_series_title,
      catalog.academic_year as catalog_academic_year,
      catalog.curriculum_revision as catalog_curriculum_revision,
      catalog.edition_label as catalog_edition_label,
      catalog.is_assignable as catalog_is_assignable,
      catalog.sort_index as catalog_sort_index
    from public.assignment_students as recipient
    join public.assignments as assignment
      on assignment.id = recipient.assignment_id
    join public.vocab_datasets as dataset
      on dataset.id = assignment.dataset_id
    left join public.vocab_dataset_catalog as catalog
      on catalog.dataset_id = dataset.id
    where recipient.student_id = p_student_id
      and recipient.assigned_at <= p_snapshot_at
      and (
        recipient.cancelled_at is null
        or recipient.cancelled_at > p_snapshot_at
      )
      and (
        assignment.deleted_at is null
        or assignment.deleted_at > p_snapshot_at
      )
  ),
  unit_rollup as (
    select
      link.assignment_id,
      coalesce(
        array_agg(unit.unit_label order by link.position),
        array[]::text[]
      ) as unit_labels,
      coalesce(
        array_agg(unit.sort_index order by link.position),
        array[]::integer[]
      ) as unit_sort_indexes,
      coalesce(
        array_agg(unit.unit_label order by link.position)
          filter (where link.is_primary),
        array[]::text[]
      ) as primary_unit_labels,
      coalesce(
        array_agg(unit.sort_index order by link.position)
          filter (where link.is_primary),
        array[]::integer[]
      ) as primary_unit_sort_indexes
    from public.assignment_units as link
    join public.vocab_units as unit
      on unit.id = link.unit_id
    join recipient_base as target
      on target.assignment_id = link.assignment_id
    group by link.assignment_id
  ),
  base_rows as (
    select
      recipient.*,
      case
        when cardinality(coalesce(units.unit_labels, array[]::text[])) > 0
          then units.unit_labels
        else array[
          recipient.range_start::text || '~' ||
          recipient.range_end::text || '번'
        ]
      end as unit_labels,
      case
        when cardinality(
          coalesce(units.primary_unit_labels, array[]::text[])
        ) > 0 then units.primary_unit_labels
        else array[]::text[]
      end as primary_unit_labels,
      case
        when cardinality(
          coalesce(units.unit_sort_indexes, array[]::integer[])
        ) > 0 then units.unit_sort_indexes
        else array[]::integer[]
      end as unit_sort_indexes,
      case
        when cardinality(
          coalesce(units.primary_unit_sort_indexes, array[]::integer[])
        ) > 0 then units.primary_unit_sort_indexes
        else array[]::integer[]
      end as primary_unit_sort_indexes,
      attempt.id as attempt_id,
      attempt.status::text as raw_attempt_status,
      attempt.phase::text as raw_attempt_phase,
      attempt.started_at,
      attempt.initial_completed_at,
      attempt.retry_started_at,
      attempt.deadline_at,
      attempt.completed_at,
      attempt.question_count_snapshot,
      attempt.passing_score_snapshot,
      attempt.retry_passing_score_snapshot,
      attempt.unresolved_wrong_count,
      attempt.initial_score,
      attempt.final_score,
      attempt.passed
    from recipient_base as recipient
    left join unit_rollup as units
      on units.assignment_id = recipient.assignment_id
    left join lateral (
      select candidate.*
      from public.quiz_attempts as candidate
      where candidate.student_id = p_student_id
        and candidate.assignment_id = recipient.assignment_id
        and candidate.started_at <= p_snapshot_at
      order by
        candidate.attempt_number desc,
        candidate.started_at desc,
        candidate.id desc
      limit 1
    ) as attempt on true
  ),
  projected_rows as (
    select
      base.*,
      case
        when base.attempt_id is null then null
        when (
          base.completed_at is null
          or base.completed_at > p_snapshot_at
        )
          and (
            case
              when base.retry_started_at is not null
                and base.retry_started_at <= p_snapshot_at then 'retry'
              when base.initial_completed_at is not null
                and base.initial_completed_at <= p_snapshot_at then 'review'
              else 'initial'
            end
          ) <> 'review'
          and base.deadline_at <= p_snapshot_at
          then 'expired'
        when base.completed_at is null
          or base.completed_at > p_snapshot_at
          then 'in_progress'
        else base.raw_attempt_status
      end as last_status,
      case
        when base.attempt_id is null then null
        when base.completed_at is not null
          and base.completed_at <= p_snapshot_at
          then base.raw_attempt_phase
        when base.retry_started_at is not null
          and base.retry_started_at <= p_snapshot_at then 'retry'
        when base.initial_completed_at is not null
          and base.initial_completed_at <= p_snapshot_at then 'review'
        else 'initial'
      end as last_phase,
      case
        when coalesce(
          base.initial_completed_at,
          base.completed_at
        ) <= p_snapshot_at then base.initial_score
        else null
      end as visible_initial_score,
      case
        when base.completed_at <= p_snapshot_at then base.final_score
        else null
      end as visible_final_score,
      case
        when base.completed_at <= p_snapshot_at then base.passed
        else null
      end as visible_passed,
      case
        when base.completed_at <= p_snapshot_at
          then base.unresolved_wrong_count
        else null
      end as visible_unresolved_wrong_count,
      case
        when base.initial_completed_at <= p_snapshot_at
          then base.initial_completed_at
        else null
      end as visible_initial_completed_at,
      case
        when base.retry_started_at <= p_snapshot_at
          then base.retry_started_at
        else null
      end as visible_retry_started_at,
      case
        when base.completed_at <= p_snapshot_at then base.completed_at
        else null
      end as visible_completed_at,
      case
        when base.timing_mode = 'none'
          or not isfinite(base.deadline_at) then null
        else base.deadline_at
      end as visible_deadline_at,
      coalesce(
        base.question_count_snapshot,
        base.question_count
      ) as projected_question_count,
      case
        when base.attempt_id is null then base.passing_score
        when base.retry_started_at is not null
          and base.retry_started_at <= p_snapshot_at
          and base.retry_passing_score_snapshot is not null
          then base.retry_passing_score_snapshot
        else base.passing_score_snapshot
      end as projected_passing_score
    from base_rows as base
  ),
  kind_rows as (
    select
      projected.*,
      case
        when projected.attempt_id is null then 'not_started'
        when projected.last_status = 'expired' then 'expired'
        when projected.last_status = 'in_progress'
          and projected.last_phase = 'review' then 'review_pending'
        when projected.last_status = 'in_progress'
          and (
            projected.last_phase = 'retry'
            or projected.visible_retry_started_at is not null
          ) then 'retry_in_progress'
        when projected.last_status = 'in_progress'
          then 'initial_in_progress'
        when projected.last_status = 'completed'
          and not (
            case
              when coalesce(
                projected.visible_final_score,
                projected.visible_initial_score
              ) is not null then coalesce(
                projected.visible_final_score,
                projected.visible_initial_score
              ) >= projected.projected_passing_score
              else projected.visible_passed is true
            end
          ) then 'failed'
        when projected.visible_retry_started_at is not null
          then 'completed_after_retry'
        else 'completed_first_try'
      end as activity_kind
    from projected_rows as projected
  ),
  classified_rows as (
    select
      kind.*,
      release.value as release,
      case
        when kind.activity_kind in (
          'completed_first_try',
          'completed_after_retry'
        ) then 'completed'
        when kind.attempt_id is null and release.value->>'state' = 'cancelled' then 'deadline_closed'
        when kind.attempt_id is null and kind.assignment_status = 'active'
          and release.value->>'state' in ('held','schedule_conflict') then 'needs_attention'
        when kind.attempt_id is null and kind.assignment_status = 'active'
          and release.value->>'state' in ('waiting_initial','waiting_time') then 'scheduled'
        when kind.attempt_id is null
          and (
            kind.missed_at is not null
            or kind.assignment_status <> 'active'
            or (
              kind.available_from is not null
              and kind.available_until is not null
              and kind.available_until <= kind.available_from
            )
            or (
              kind.available_until is not null
              and kind.available_until <= p_snapshot_at
            )
          ) then 'deadline_closed'
        when kind.attempt_id is null
          and kind.available_from is not null
          and kind.available_from > p_snapshot_at then 'scheduled'
        when kind.activity_kind in (
          'review_pending',
          'expired',
          'failed'
        ) then 'needs_attention'
        else 'open'
      end as dashboard_section,
      case
        when kind.attempt_id is null
          and (
            kind.missed_at is not null
            or (
              kind.available_until is not null
              and kind.available_until <= p_snapshot_at
            )
          ) then coalesce(
            kind.missed_at,
            kind.available_until,
            kind.assigned_at
          )
        when kind.attempt_id is null then kind.assigned_at
        when kind.activity_kind = 'expired'
          then coalesce(kind.visible_deadline_at, kind.started_at)
        when kind.activity_kind = 'review_pending'
          then coalesce(kind.visible_initial_completed_at, kind.started_at)
        when kind.activity_kind = 'retry_in_progress'
          then coalesce(kind.visible_retry_started_at, kind.started_at)
        when kind.activity_kind = 'initial_in_progress'
          then kind.started_at
        else coalesce(kind.visible_completed_at, kind.started_at)
      end as effective_at
    from kind_rows as kind
    cross join lateral (select private.student_assignment_release_v1(
      p_student_id, kind.assignment_id, p_snapshot_at
    ) as value) as release
  )
  select
    classified.assignment_id,
    classified.effective_at,
    classified.dashboard_section,
    jsonb_build_object(
      '_dataset', jsonb_build_object(
        'title', classified.raw_dataset_title,
        'edition', classified.raw_dataset_edition,
        'catalog', case
          when classified.catalog_display_name is null then null
          else jsonb_build_object(
            'displayName', classified.catalog_display_name,
            'catalogGroup', classified.catalog_group,
            'materialKind', classified.material_kind,
            'gradeCode', classified.catalog_grade_code,
            'publisher', classified.catalog_publisher,
            'seriesTitle', classified.catalog_series_title,
            'academicYear', classified.catalog_academic_year,
            'curriculumRevision', classified.catalog_curriculum_revision,
            'editionLabel', classified.catalog_edition_label,
            'isAssignable', classified.catalog_is_assignable,
            'sortIndex', classified.catalog_sort_index
          )
        end
      ),
      'release', classified.release,
      'id', classified.assignment_id,
      'assignmentStatus', classified.assignment_status,
      'title', classified.title,
      'assignmentPurpose', classified.assignment_purpose,
      'unitLabels', to_jsonb(classified.unit_labels),
      'unitSortIndexes', to_jsonb(classified.unit_sort_indexes),
      'primaryUnitLabels', to_jsonb(classified.primary_unit_labels),
      'primaryUnitSortIndexes',
        to_jsonb(classified.primary_unit_sort_indexes),
      'questionCount', classified.projected_question_count,
      'passingScore', classified.projected_passing_score,
      'retakeAllowed', classified.retake_allowed,
      'lastAttemptId', classified.attempt_id,
      'lastStatus', classified.last_status,
      'lastPhase', classified.last_phase,
      'lastInitialScore', classified.visible_initial_score,
      'lastFinalScore', classified.visible_final_score,
      'lastPassed', classified.visible_passed,
      'lastRetryStartedAt', classified.visible_retry_started_at,
      'lastStartedAt', classified.started_at,
      'lastInitialCompletedAt', classified.visible_initial_completed_at,
      'lastCompletedAt', classified.visible_completed_at,
      'lastDeadlineAt', classified.visible_deadline_at,
      'lastUnresolvedWrongCount',
        classified.visible_unresolved_wrong_count,
      'assignedAt', classified.assigned_at,
      'availableFrom', classified.available_from,
      'availableUntil', classified.available_until,
      'missedAt', classified.missed_at
    ) as item
  from classified_rows as classified;
$$;

create function public.get_student_dashboard_initial_v2(
  p_student_id uuid,
  p_snapshot_at timestamptz default null
)
returns table (
  snapshot_at timestamptz,
  current_items jsonb,
  completed_items jsonb,
  open_count bigint,
  scheduled_count bigint,
  needs_attention_count bigint,
  completed_count bigint,
  deadline_closed_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  snapshot_value timestamptz := coalesce(
    p_snapshot_at,
    statement_timestamp()
  );
begin
  if p_student_id is null
    or not isfinite(snapshot_value)
    or snapshot_value > statement_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid student dashboard snapshot';
  end if;

  return query
  with parameters as (
    select snapshot_value as snapshot_at
  ),
  dashboard_rows as materialized (
    select row.*
    from parameters as parameter
    cross join lateral private.student_dashboard_read_rows_v2(
      p_student_id,
      parameter.snapshot_at
    ) as row
  ),
  completed_page as (
    select row.*
    from dashboard_rows as row
    where row.dashboard_section = 'completed'
    order by row.effective_at desc, row.assignment_id asc
    limit 11
  )
  select
    parameter.snapshot_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'dashboardSection', row.dashboard_section,
            'effectiveAt', row.effective_at,
            'assignmentId', row.assignment_id,
            'item', row.item
          )
          order by
            case row.dashboard_section
              when 'open' then 1
              when 'scheduled' then 2
              when 'needs_attention' then 3
              when 'deadline_closed' then 4
              else 5
            end,
            row.effective_at desc,
            row.assignment_id asc
        )
        from dashboard_rows as row
        where row.dashboard_section <> 'completed'
      ),
      '[]'::jsonb
    ) as current_items,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'effectiveAt', page.effective_at,
            'assignmentId', page.assignment_id,
            'item', page.item
          )
          order by page.effective_at desc, page.assignment_id asc
        )
        from completed_page as page
      ),
      '[]'::jsonb
    ) as completed_items,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'open'
    ) as open_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'scheduled'
    ) as scheduled_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'needs_attention'
    ) as needs_attention_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'completed'
    ) as completed_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'deadline_closed'
    ) as deadline_closed_count
  from parameters as parameter;
end;
$$;

create function public.list_student_dashboard_completed_page_v2(
  p_student_id uuid,
  p_snapshot_at timestamptz,
  p_cursor_effective_at timestamptz,
  p_cursor_assignment_id uuid
)
returns table (
  cursor_effective_at timestamptz,
  cursor_assignment_id uuid,
  item jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_student_id is null
    or p_snapshot_at is null
    or p_cursor_effective_at is null
    or p_cursor_assignment_id is null
    or not isfinite(p_snapshot_at)
    or not isfinite(p_cursor_effective_at)
    or p_cursor_effective_at > p_snapshot_at
    or p_snapshot_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid student dashboard cursor';
  end if;

  return query
  select
    row.effective_at as cursor_effective_at,
    row.assignment_id as cursor_assignment_id,
    row.item
  from private.student_dashboard_read_rows_v2(
    p_student_id,
    p_snapshot_at
  ) as row
  where row.dashboard_section = 'completed'
    and (
      row.effective_at < p_cursor_effective_at
      or (
        row.effective_at = p_cursor_effective_at
        and row.assignment_id > p_cursor_assignment_id
      )
    )
  order by row.effective_at desc, row.assignment_id asc
  limit 11;
end;
$$;

revoke all on function private.student_dashboard_read_rows_v2(
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function private.student_dashboard_read_rows_v2(
  uuid,
  timestamptz
) to service_role;

revoke all on function public.get_student_dashboard_initial_v2(
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.get_student_dashboard_initial_v2(
  uuid,
  timestamptz
) to service_role;

revoke all on function public.list_student_dashboard_completed_page_v2(
  uuid,
  timestamptz,
  timestamptz,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.list_student_dashboard_completed_page_v2(
  uuid,
  timestamptz,
  timestamptz,
  uuid
) to service_role;


create or replace function public.finalize_missed_assignments(
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
  locked_cancelled_at timestamptz;
  current_deadline timestamptz;
  finalization_cutoff timestamptz := clock_timestamp();
  finalized_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_finalize_limit' using errcode = '22023';
  end if;

  for candidate in
    select link.assignment_id, link.student_id
    from public.assignments as assignment
    join public.assignment_students as link
      on link.assignment_id = assignment.id
    where private.student_assignment_release_v1(link.student_id, link.assignment_id, finalization_cutoff)->>'state'
        in ('open','unrestricted')
      and link.missed_at is null
      and link.cancelled_at is null
      and assignment.available_until is not null
      and assignment.available_until <= finalization_cutoff
      and (p_student_id is null or link.student_id = p_student_id)
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
    if not found then continue; end if;

    select link.missed_at, link.cancelled_at
    into locked_missed_at, locked_cancelled_at
    from public.assignment_students as link
    where link.assignment_id = candidate.assignment_id
      and link.student_id = candidate.student_id
    for update skip locked;
    if not found
      or locked_missed_at is not null
      or locked_cancelled_at is not null
    then
      continue;
    end if;

    select assignment.available_until
    into current_deadline
    from public.assignments as assignment
    where assignment.id = candidate.assignment_id;
    if private.student_assignment_release_v1(candidate.student_id, candidate.assignment_id, finalization_cutoff)->>'state'
        not in ('open','unrestricted')
      or current_deadline is null
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
      and link.missed_at is null
      and link.cancelled_at is null;
    if found then
      update public.assignment_review_targets
      set
        released_at = current_deadline,
        release_reason = 'missed'
      where assignment_id = candidate.assignment_id
        and student_id = candidate.student_id
        and released_at is null;

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

create or replace function private.student_assignment_study_content_v1(p_student_id uuid, p_assignment_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with permitted as materialized (
    select a.id, a.title, a.quiz_content_mode
    from public.assignments a
    join public.assignment_students recipient on recipient.assignment_id = a.id
    join public.students student on student.id = recipient.student_id
    where a.id = p_assignment_id and recipient.student_id = p_student_id
      and recipient.cancelled_at is null and recipient.assigned_at <= now()
      and a.deleted_at is null and a.status in ('active', 'closed')
      and student.deleted_at is null and student.status = 'active'
  ), learning_rows as (
    select q.vocab_entry_id, e.dataset_id, e.source_row,
      jsonb_build_object(
        'entryId', q.vocab_entry_id,
        'headword', coalesce(nullif(s.headword_snapshot, ''), case when q.provenance_status in ('verified_v2','reviewed_for_preview_v1','preview_verified_v1') then nullif(q.headword_snapshot, '') end, e.headword),
        'meaning', coalesce(nullif(s.primary_meaning_snapshot, ''), case when q.provenance_status in ('verified_v2','reviewed_for_preview_v1','preview_verified_v1') then nullif(q.primary_meaning_snapshot, '') end, e.primary_meaning),
        'displayKo', coalesce(s.display_pronunciation_ko_snapshot, e.pronunciation_ko),
        'pronunciationSnapshot', s.pronunciation_snapshot,
        'dictionaryId', s.dictionary_id,
        'releaseId', coalesce(s.release_id, r.exam_use_release_id),
        'definition', case when q.eligibility_quiz_mode = 'canonical_definition_to_headword' then q.prompt end,
        'example', case when q.eligibility_quiz_mode = 'canonical_example_to_headword' then x.example_en end
      ) as item
    from permitted a
    join public.assignment_questions q on q.assignment_id = a.id
    join public.vocab_entries e on e.id = q.vocab_entry_id
    left join public.assignment_question_exam_use_snapshot s
      on s.assignment_question_id = q.id and s.provenance_status = 'reviewed_for_preview_v1'
    left join word_index.app_canonical_question_preview_release r
      on r.release_id = q.canonical_question_release_id_snapshot
    left join word_index.app_canonical_question_preview_item source
      on source.release_id = q.canonical_question_release_id_snapshot
      and source.vocab_entry_id = q.vocab_entry_id
      and source.quiz_mode = q.eligibility_quiz_mode
      and source.question_item_id = q.canonical_question_item_id_snapshot
      and source.question_item_sha256 = q.canonical_question_item_sha256_snapshot
    left join private.assignment_study_examples_v1 x
      on x.release_id = source.release_id and x.vocab_entry_id = source.vocab_entry_id
      and x.question_item_id = source.question_item_id
      and x.question_item_sha256 = source.question_item_sha256
      and x.source_example_sha256 = source.source_example_content_hash
  )
  select jsonb_build_object('assignmentId', a.id, 'title', a.title, 'mode', a.quiz_content_mode,
    'words', coalesce((select jsonb_agg(item order by dataset_id, source_row, vocab_entry_id) from learning_rows), '[]'::jsonb))
  from permitted a;
$$;


create or replace function public.get_student_assignment_study_v1(p_student_id uuid, p_assignment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare release_value jsonb; safe_header jsonb;
begin
  release_value := private.student_assignment_release_v1(p_student_id,p_assignment_id,statement_timestamp());
  if release_value->>'state' = 'unavailable' then return null; end if;
  if release_value->>'state' not in ('open','unrestricted') and not exists (
    select 1 from public.quiz_attempts where student_id = p_student_id and assignment_id = p_assignment_id
  ) then
    select jsonb_build_object('assignmentId',id,'title',title,'mode',quiz_content_mode,'release',release_value)
      into safe_header from public.assignments where id = p_assignment_id;
    return safe_header;
  end if;
  return private.student_assignment_study_content_v1(p_student_id,p_assignment_id);
end;
$$;
revoke all on function private.student_assignment_study_content_v1(uuid,uuid) from public, anon, authenticated, service_role;



-- Existing real request relationships are revalidated. Ambiguity aborts this
-- migration rather than publishing an inferred relationship.
do $backfill$
declare receipt record; candidate record;
begin
  -- The DDL above already excludes concurrent writes to queue/receipt tables.
  -- Do not wait for a live worker that holds student -> waits for this DDL:
  -- either acquire every affected student in ID order now, or abort the whole
  -- migration without changing live work. A later quiet-window retry is safe.
  perform student.id
    from public.students student
    where exists (
      select 1 from private.vocab_assignment_series series
      where series.student_id = student.id
    ) or exists (
      select 1 from private.bulk_vocab_series_requests request
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(request.result) = 'array' then request.result else '[]'::jsonb end
      ) result
      where result->>'student_id' = student.id::text
    )
    order by student.id
    for update of student nowait;
  -- Only an explicit recorded skip establishes this exception, never a normal
  -- cancellation/expiry. Preserve source receipts and historical audit events.
  update private.vocab_assignment_series_items i
    set status = 'deferred', deferred_at = skipped.occurred_at,
      cancelled_at = null, updated_at = clock_timestamp()
    from (
      select item_id, max(occurred_at) occurred_at
      from private.vocab_assignment_series_events
      where event_kind = 'session.skipped' and details->>'action' = 'skip'
      group by item_id
    ) skipped
    where i.id = skipped.item_id and i.status = 'cancelled';
  update private.vocab_assignment_series s
    set status = 'deferred', completed_at = null, updated_at = clock_timestamp()
    where s.status = 'completed' and exists (
      select 1 from private.vocab_assignment_series_items i
      where i.series_id = s.id and i.status = 'deferred'
    );
  for receipt in select idempotency_key,result from private.bulk_vocab_series_requests
    where result is not null order by created_at,idempotency_key
  loop
    perform private.register_assignment_release_links_v1(receipt.idempotency_key,receipt.result);
  end loop;
  for candidate in
    select a.id, a.student_id from public.quiz_attempts a
      join private.vocab_assignment_series_items i on i.assignment_id = a.assignment_id
      join private.vocab_assignment_series s on s.id = i.series_id and s.student_id = a.student_id
      where a.initial_completed_at is not null
        and (i.status = 'assigned' or (i.status = 'attention' and i.attention_reason = 'assignment_expired'))
      order by a.student_id,s.id,i.sequence_number,a.initial_completed_at,a.id
  loop
    perform 1 from public.students where id = candidate.student_id for update;
    perform private.advance_vocab_queue_first_attempt_v1(candidate.id);
  end loop;
end;
$backfill$;
notify pgrst, 'reload schema';
commit;
