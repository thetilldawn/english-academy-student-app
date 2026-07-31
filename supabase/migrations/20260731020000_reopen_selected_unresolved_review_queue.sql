begin;

-- Keep the existing lifecycle lock order (student -> vocabulary state). The
-- initial-wrong writer otherwise reaches student_vocab_state before the
-- restoration trigger serializes the queue identity.
create function private.lock_student_before_initial_wrong_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.students as student
  where student.id = new.student_id
  for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger quiz_attempts_lock_student_before_initial_wrong_state
before update of phase on public.quiz_attempts
for each row
when (
  old.phase = 'initial'
  and new.phase = 'review'
  and new.status = 'in_progress'
)
execute function private.lock_student_before_initial_wrong_state();

revoke all on function private.lock_student_before_initial_wrong_state()
  from public, anon, authenticated, service_role;

-- A queue row records the teacher's explicit choice to carry a wrong word into
-- a later test. If that same word is still unresolved after a missed test, or
-- becomes unresolved again in a later attempt, restore one historical choice
-- instead of silently losing it from the assignment screen.
create function private.reopen_selected_vocab_review_queue_v1(
  p_student_id uuid,
  p_vocab_entry_id bigint,
  p_wrong_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_dataset_id uuid;
  target_canonical_id uuid;
  target_headword_key text;
  target_reason_level smallint;
  pending_queue_id uuid;
  historical_queue_id uuid;
begin
  if p_student_id is null
    or p_vocab_entry_id is null
    or coalesce(p_wrong_count, 0) <= 0
  then
    return null;
  end if;

  -- All assignment and review-queue writers use the student row as their
  -- serialization lock. Reuse the same order for automatic restoration.
  perform 1
  from public.students as student
  where student.id = p_student_id
  for update;
  if not found then
    return null;
  end if;

  select
    entry.dataset_id,
    min(eligibility.canonical_lexeme_id::text)::uuid,
    lower(trim(replace(entry.headword_normalized, '*', '')))
  into
    target_dataset_id,
    target_canonical_id,
    target_headword_key
  from public.vocab_entries as entry
  left join public.vocab_entry_quiz_eligibility as eligibility
    on eligibility.vocab_entry_id = entry.id
    and eligibility.dataset_id = entry.dataset_id
    and eligibility.status = 'eligible'
  where entry.id = p_vocab_entry_id
  group by entry.dataset_id, entry.headword_normalized;

  if not found
    or not exists (
      select 1
      from public.student_vocab_state as state
      where state.student_id = p_student_id
        and state.vocab_entry_id = p_vocab_entry_id
        and state.unresolved_wrong_count > 0
        and state.resolved_at is null
    )
  then
    return null;
  end if;

  select least(
    2,
    greatest(
      1,
      p_wrong_count,
      count(distinct wrong_event.quiz_attempt_id) filter (
        where wrong_event.wrong_stage = 'initial'
      )
    )
  )::smallint
  into target_reason_level
  from public.student_vocab_wrong_events as wrong_event
  join public.vocab_entries as wrong_entry
    on wrong_entry.id = wrong_event.vocab_entry_id
    and wrong_entry.dataset_id = wrong_event.dataset_id
  where wrong_event.student_id = p_student_id
    and wrong_event.dataset_id = target_dataset_id
    and (
      wrong_event.vocab_entry_id = p_vocab_entry_id
      or (
        target_canonical_id is not null
        and wrong_event.canonical_lexeme_id_snapshot = target_canonical_id
      )
      or (
        target_canonical_id is null
        and wrong_event.canonical_lexeme_id_snapshot is null
        and lower(trim(replace(
          wrong_entry.headword_normalized,
          '*',
          ''
        ))) = target_headword_key
      )
    );

  -- A pending row remains pending while it is linked to an active assignment.
  -- Only its visible one-time/two-or-more level needs refreshing.
  select queue.id
  into pending_queue_id
  from public.student_vocab_review_queue as queue
  join public.vocab_entries as queue_entry
    on queue_entry.id = queue.vocab_entry_id
    and queue_entry.dataset_id = queue.dataset_id
  where queue.student_id = p_student_id
    and queue.dataset_id = target_dataset_id
    and queue.status = 'pending'
    and (
      queue.vocab_entry_id = p_vocab_entry_id
      or (
        target_canonical_id is not null
        and queue.canonical_lexeme_id_snapshot = target_canonical_id
      )
      or (
        target_canonical_id is null
        and queue.canonical_lexeme_id_snapshot is null
        and lower(trim(replace(
          queue_entry.headword_normalized,
          '*',
          ''
        ))) = target_headword_key
      )
    )
  order by queue.updated_at desc, queue.queued_at desc, queue.id
  limit 1
  for update of queue;

  if pending_queue_id is not null then
    update public.student_vocab_review_queue
    set reason_level = greatest(
      reason_level,
      target_reason_level
    )
    where id = pending_queue_id;
    return pending_queue_id;
  end if;

  -- Do not make an additional pending copy while the same identity is still
  -- attached to another live assignment.
  if exists (
    select 1
    from public.assignment_review_targets as target
    join public.vocab_entries as target_entry
      on target_entry.id = target.vocab_entry_id
      and target_entry.dataset_id = target.dataset_id
    where target.student_id = p_student_id
      and target.dataset_id = target_dataset_id
      and target.released_at is null
      and (
        target.vocab_entry_id = p_vocab_entry_id
        or (
          target_canonical_id is not null
          and target.canonical_lexeme_id_snapshot = target_canonical_id
        )
        or (
          target_canonical_id is null
          and target.canonical_lexeme_id_snapshot is null
          and lower(trim(replace(
            target_entry.headword_normalized,
            '*',
            ''
          ))) = target_headword_key
        )
      )
  ) then
    return null;
  end if;

  -- Reuse exactly one latest historical teacher selection. Words that were
  -- never selected by the teacher are intentionally not auto-queued.
  select queue.id
  into historical_queue_id
  from public.student_vocab_review_queue as queue
  join public.vocab_entries as queue_entry
    on queue_entry.id = queue.vocab_entry_id
    and queue_entry.dataset_id = queue.dataset_id
  where queue.student_id = p_student_id
    and queue.dataset_id = target_dataset_id
    and queue.status in ('consumed', 'cancelled')
    and (
      queue.vocab_entry_id = p_vocab_entry_id
      or (
        target_canonical_id is not null
        and queue.canonical_lexeme_id_snapshot = target_canonical_id
      )
      or (
        target_canonical_id is null
        and queue.canonical_lexeme_id_snapshot is null
        and lower(trim(replace(
          queue_entry.headword_normalized,
          '*',
          ''
        ))) = target_headword_key
      )
    )
  order by queue.updated_at desc, queue.queued_at desc, queue.id
  limit 1
  for update of queue;

  if historical_queue_id is null then
    return null;
  end if;

  update public.student_vocab_review_queue
  set
    status = 'pending',
    reason_level = greatest(
      reason_level,
      target_reason_level
    ),
    consumed_assignment_id = null,
    consumed_at = null,
    cancelled_at = null,
    reserved_review_draft_id = null,
    reserved_at = null
  where id = historical_queue_id;

  return historical_queue_id;
end;
$$;

revoke all on function private.reopen_selected_vocab_review_queue_v1(
  uuid,
  bigint,
  integer
) from public, anon, authenticated, service_role;

create function private.reopen_selected_vocab_review_queue_after_state_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unresolved_wrong_count <= 0
    or new.resolved_at is not null
  then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.unresolved_wrong_count > 0
      and old.resolved_at is null
      and new.last_attempt_id is not distinct from old.last_attempt_id
    then
      return new;
    end if;
  end if;

  perform private.reopen_selected_vocab_review_queue_v1(
    new.student_id,
    new.vocab_entry_id,
    new.unresolved_wrong_count
  );
  return new;
end;
$$;

create trigger student_vocab_state_reopen_selected_review_queue
after insert or update on public.student_vocab_state
for each row
execute function private.reopen_selected_vocab_review_queue_after_state_change();

revoke all on function
  private.reopen_selected_vocab_review_queue_after_state_change()
from public, anon, authenticated, service_role;

create function private.reopen_selected_vocab_review_queue_after_missed_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_wrong_count integer;
begin
  if old.released_at is not null
    or new.released_at is null
    or new.release_reason <> 'missed'
  then
    return new;
  end if;

  select state.unresolved_wrong_count
  into current_wrong_count
  from public.student_vocab_state as state
  where state.student_id = new.student_id
    and state.vocab_entry_id = new.vocab_entry_id
    and state.resolved_at is null;

  if coalesce(current_wrong_count, 0) > 0 then
    perform private.reopen_selected_vocab_review_queue_v1(
      new.student_id,
      new.vocab_entry_id,
      current_wrong_count
    );
  end if;
  return new;
end;
$$;

create trigger assignment_review_targets_reopen_queue_after_missed
after update of released_at, release_reason
on public.assignment_review_targets
for each row
execute function
  private.reopen_selected_vocab_review_queue_after_missed_target();

revoke all on function
  private.reopen_selected_vocab_review_queue_after_missed_target()
from public, anon, authenticated, service_role;

-- Repair existing rows with the same conservative rule. This only revives
-- identities that have a historical explicit teacher selection.
do $$
declare
  unresolved record;
begin
  for unresolved in
    select
      state.student_id,
      state.vocab_entry_id,
      state.unresolved_wrong_count
    from public.student_vocab_state as state
    where state.unresolved_wrong_count > 0
      and state.resolved_at is null
    order by state.student_id, state.vocab_entry_id
  loop
    perform private.reopen_selected_vocab_review_queue_v1(
      unresolved.student_id,
      unresolved.vocab_entry_id,
      unresolved.unresolved_wrong_count
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
