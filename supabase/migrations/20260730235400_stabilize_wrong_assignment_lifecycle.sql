begin;

-- The previous persistence routine required one new DAY question beyond the
-- selected wrong words. The assignment union may now consist entirely of
-- selected wrong words while keeping the chosen DAY scope for reporting.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'::regprocedure
  )
  into function_definition;

  if position(
    'review_question_count >= total_question_count'
    in function_definition
  ) = 0
    or position(
      'cardinality(p_review_queue_ids) not between 1 and 400'
      in function_definition
    ) = 0
  then
    raise exception 'persist_review_assignment_v5_shape_changed';
  end if;

  execute replace(
    replace(
      function_definition,
      'review_question_count >= total_question_count',
      'review_question_count > total_question_count'
    ),
    'cardinality(p_review_queue_ids) not between 1 and 400',
    'cardinality(p_review_queue_ids) not between 1 and 500'
  );
end;
$$;

-- A recipient can be cancelled only before any attempt exists. Cancellation is
-- durable history, while the assignment itself may continue for other students.
alter table public.assignment_students
  add column cancelled_at timestamptz,
  add column cancelled_by uuid
    references auth.users(id) on delete restrict,
  add column cancellation_reason text;

alter table public.assignment_students
  add constraint assignment_students_cancel_state_check check (
    (
      cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null
    )
    or (
      cancelled_at is not null
      and cancelled_at >= assigned_at
      and cancelled_by is not null
      and char_length(trim(cancellation_reason)) between 1 and 500
    )
  ),
  add constraint assignment_students_terminal_state_exclusive check (
    missed_at is null or cancelled_at is null
  );

drop index if exists public.assignment_students_pending_missed_idx;
create index assignment_students_pending_missed_idx
  on public.assignment_students (assignment_id, student_id)
  where missed_at is null and cancelled_at is null;

-- Retire the old exact-retest draft workflow without losing its queue words.
update public.student_vocab_review_queue
set
  reserved_review_draft_id = null,
  reserved_at = null
where status = 'pending'
  and reserved_review_draft_id is not null;

update public.student_vocab_review_assignment_drafts
set
  status = 'cancelled',
  cancelled_at = coalesce(cancelled_at, clock_timestamp())
where status = 'pending';

-- Legacy active duplicates are intentionally left visible. Automatically
-- cancelling a whole recipient would also remove its non-overlapping words.
-- New creators below lock the student and reject every new overlap; teachers
-- can use the explicit cancellation action to retire an old unstarted test.

-- Only the atomic v4 regular creator and v6 mixed creator may create new
-- assignments. Revoke all legacy entry points so an older client cannot
-- bypass student locking, duplicate checks, or timing rollback.
revoke all on function public.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.create_assignment_with_question_bank(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_question_bank(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_assignment_with_question_bank_v2(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_question_bank_v2(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_assignment_with_question_bank_v3(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_question_bank_v3(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_student_vocab_review_assignment_draft(
  uuid, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function private.create_student_vocab_review_assignment_draft(
  uuid, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.create_exact_review_assignment_v4(
  uuid, text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_exact_review_assignment_v4(
  uuid, text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v5(
  uuid, uuid, smallint[], integer, uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_mixed_review_assignment_v5(
  uuid, uuid, smallint[], integer, uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;

-- Queue state says "teacher wants this unresolved word in a future test".
-- Assignment state is tracked independently so assigning a word never removes
-- it from the teacher's stable wrong-word pool.
create table public.assignment_review_targets (
  id uuid primary key default extensions.gen_random_uuid(),
  assignment_id uuid not null,
  student_id uuid not null,
  review_queue_id uuid not null
    references public.student_vocab_review_queue(id) on delete restrict,
  assignment_question_id uuid not null
    references public.assignment_questions(id) on delete restrict,
  dataset_id uuid not null,
  vocab_entry_id bigint not null,
  canonical_lexeme_id_snapshot uuid,
  assigned_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  release_reason text,
  foreign key (assignment_id, student_id)
    references public.assignment_students(assignment_id, student_id)
    on delete restrict,
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete restrict,
  unique (assignment_id, student_id, review_queue_id),
  constraint assignment_review_targets_release_check check (
    (
      released_at is null
      and release_reason is null
    )
    or (
      released_at is not null
      and release_reason in (
        'resolved',
        'completed_unresolved',
        'cancelled',
        'missed',
        'assignment_closed',
        'migration_superseded'
      )
    )
  )
);

create index assignment_review_targets_assignment_student_idx
  on public.assignment_review_targets (assignment_id, student_id);
create index assignment_review_targets_queue_idx
  on public.assignment_review_targets (review_queue_id);
create index assignment_review_targets_student_dataset_idx
  on public.assignment_review_targets (
    student_id,
    dataset_id,
    assigned_at desc
  )
  where released_at is null;
create index assignment_review_targets_active_entry_idx
  on public.assignment_review_targets (
    student_id,
    dataset_id,
    vocab_entry_id
  )
  where released_at is null;
create index assignment_review_targets_active_canonical_idx
  on public.assignment_review_targets (
    student_id,
    dataset_id,
    canonical_lexeme_id_snapshot
  )
  where released_at is null
    and canonical_lexeme_id_snapshot is not null;

-- Every historical consumed queue row must still identify its recipient and
-- persisted assignment question. Abort rather than inventing a relationship.
do $$
begin
  if exists (
    select 1
    from public.student_vocab_review_queue as queue
    where queue.status = 'consumed'
      and (
        not exists (
          select 1
          from public.assignment_students as link
          where link.assignment_id = queue.consumed_assignment_id
            and link.student_id = queue.student_id
        )
        or not exists (
          select 1
          from public.assignment_questions as question
          where question.assignment_id = queue.consumed_assignment_id
            and question.vocab_entry_id = queue.vocab_entry_id
        )
      )
  ) then
    raise exception 'orphan_consumed_review_queue';
  end if;
end;
$$;

-- Preserve legacy consumed rows as target history. Existing duplicate active
-- identities are retained; a trigger installed after this backfill rejects all
-- new duplicates.
insert into public.assignment_review_targets (
  assignment_id,
  student_id,
  review_queue_id,
  assignment_question_id,
  dataset_id,
  vocab_entry_id,
  canonical_lexeme_id_snapshot,
  assigned_at,
  released_at,
  release_reason
)
select
  queue.consumed_assignment_id,
  queue.student_id,
  queue.id,
  bank_question.id,
  queue.dataset_id,
  queue.vocab_entry_id,
  queue.canonical_lexeme_id_snapshot,
  coalesce(queue.consumed_at, queue.queued_at),
  case
    when link.cancelled_at is not null then link.cancelled_at
    when link.missed_at is not null then link.missed_at
    when latest_attempt.status in ('completed', 'expired')
      then coalesce(latest_attempt.completed_at, latest_attempt.deadline_at)
    when assignment.status = 'closed'
      and latest_attempt.id is null
      then assignment.updated_at
    else null
  end,
  case
    when link.cancelled_at is not null then 'cancelled'
    when link.missed_at is not null then 'missed'
    when latest_attempt.status in ('completed', 'expired')
      and (
        attempt_question.initial_is_correct is true
        or attempt_question.retry_is_correct is true
      )
      then 'resolved'
    when latest_attempt.status in ('completed', 'expired')
      then 'completed_unresolved'
    when assignment.status = 'closed'
      and latest_attempt.id is null
      then 'assignment_closed'
    else null
  end
from public.student_vocab_review_queue as queue
join public.assignment_students as link
  on link.assignment_id = queue.consumed_assignment_id
  and link.student_id = queue.student_id
join public.assignments as assignment
  on assignment.id = queue.consumed_assignment_id
join lateral (
  select question.id
  from public.assignment_questions as question
  where question.assignment_id = queue.consumed_assignment_id
    and question.vocab_entry_id = queue.vocab_entry_id
  order by question.base_order_index, question.id
  limit 1
) as bank_question on true
left join lateral (
  select
    attempt.id,
    attempt.status,
    attempt.completed_at,
    attempt.deadline_at
  from public.quiz_attempts as attempt
  where attempt.assignment_id = queue.consumed_assignment_id
    and attempt.student_id = queue.student_id
  order by attempt.attempt_number desc, attempt.id desc
  limit 1
) as latest_attempt on true
left join lateral (
  select
    question.initial_is_correct,
    question.retry_is_correct
  from public.quiz_questions as question
  where question.attempt_id = latest_attempt.id
    and question.vocab_entry_id = queue.vocab_entry_id
  limit 1
) as attempt_question on true
where queue.status = 'consumed'
on conflict (assignment_id, student_id, review_queue_id) do nothing;

-- Resolved state wins over stale queue rows.
update public.student_vocab_review_queue as queue
set
  status = 'cancelled',
  cancelled_at = clock_timestamp(),
  reserved_review_draft_id = null,
  reserved_at = null
where queue.status = 'pending'
  and exists (
    select 1
    from public.student_vocab_state as state
    where state.student_id = queue.student_id
      and state.vocab_entry_id = queue.vocab_entry_id
      and state.unresolved_wrong_count = 0
  );

-- Restore one unresolved representative per identity to pending. Legacy
-- consumed rows remain as immutable history through assignment_review_targets.
with ranked as (
  select
    queue.id,
    row_number() over (
      partition by
        queue.student_id,
        queue.dataset_id,
        coalesce(
          queue.canonical_lexeme_id_snapshot::text,
          'headword:' || lower(trim(replace(
            queue_entry.headword_normalized,
            '*',
            ''
          )))
        )
      order by queue.queued_at desc, queue.id desc
    ) as identity_rank
  from public.student_vocab_review_queue as queue
  join public.vocab_entries as queue_entry
    on queue_entry.id = queue.vocab_entry_id
    and queue_entry.dataset_id = queue.dataset_id
  where queue.status = 'consumed'
    and exists (
      select 1
      from public.student_vocab_state as state
      where state.student_id = queue.student_id
        and state.vocab_entry_id = queue.vocab_entry_id
        and state.unresolved_wrong_count > 0
    )
    and not exists (
      select 1
      from public.student_vocab_review_queue as pending
      join public.vocab_entries as pending_entry
        on pending_entry.id = pending.vocab_entry_id
        and pending_entry.dataset_id = pending.dataset_id
      where pending.student_id = queue.student_id
        and pending.dataset_id = queue.dataset_id
        and pending.status = 'pending'
        and (
          pending.vocab_entry_id = queue.vocab_entry_id
          or (
            queue.canonical_lexeme_id_snapshot is not null
            and pending.canonical_lexeme_id_snapshot =
              queue.canonical_lexeme_id_snapshot
          )
          or (
            queue.canonical_lexeme_id_snapshot is null
            and pending.canonical_lexeme_id_snapshot is null
            and lower(trim(replace(
              pending_entry.headword_normalized,
              '*',
              ''
            ))) = lower(trim(replace(
              queue_entry.headword_normalized,
              '*',
              ''
            )))
          )
        )
    )
)
update public.student_vocab_review_queue as queue
set
  status = 'pending',
  consumed_assignment_id = null,
  consumed_at = null,
  cancelled_at = null,
  reserved_review_draft_id = null,
  reserved_at = null
from ranked
where ranked.id = queue.id
  and ranked.identity_rank = 1;

-- Retry-stage events are audit only. The visible level is the number of
-- distinct exams in which the word was initially wrong.
update public.student_vocab_review_queue as queue
set reason_level = least(
  2,
  greatest(
    1,
    (
      select count(distinct wrong_event.quiz_attempt_id)
      from public.student_vocab_wrong_events as wrong_event
      where wrong_event.student_id = queue.student_id
        and wrong_event.wrong_stage = 'initial'
        and (
          (
            queue.canonical_lexeme_id_snapshot is not null
            and wrong_event.dataset_id = queue.dataset_id
            and wrong_event.canonical_lexeme_id_snapshot =
              queue.canonical_lexeme_id_snapshot
          )
          or (
            queue.canonical_lexeme_id_snapshot is null
            and wrong_event.dataset_id = queue.dataset_id
            and wrong_event.canonical_lexeme_id_snapshot is null
            and exists (
              select 1
              from public.vocab_entries as queue_entry
              join public.vocab_entries as wrong_entry
                on wrong_entry.id = wrong_event.vocab_entry_id
                and wrong_entry.dataset_id = queue_entry.dataset_id
              where queue_entry.id = queue.vocab_entry_id
                and queue_entry.dataset_id = queue.dataset_id
                and lower(trim(replace(
                  wrong_entry.headword_normalized,
                  '*',
                  ''
                ))) = lower(trim(replace(
                  queue_entry.headword_normalized,
                  '*',
                  ''
                )))
            )
          )
        )
    )
  )
)::smallint
where queue.status = 'pending';

alter table public.assignment_review_targets enable row level security;

create policy "active admins can read assignment review targets"
on public.assignment_review_targets
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.assignment_review_targets
  from public, anon, authenticated;
grant select on table public.assignment_review_targets to authenticated;
grant all on table public.assignment_review_targets to service_role;

-- Lock the student first and reject every newly inserted duplicate identity.
-- This is trigger-based because production already contains legacy duplicates
-- that must remain inspectable and cancellable.
create function private.reject_duplicate_active_review_target()
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

  if exists (
    select 1
    from public.assignment_review_targets as target
    where target.student_id = new.student_id
      and target.dataset_id = new.dataset_id
      and target.released_at is null
      and (
        target.vocab_entry_id = new.vocab_entry_id
        or (
          new.canonical_lexeme_id_snapshot is not null
          and target.canonical_lexeme_id_snapshot =
            new.canonical_lexeme_id_snapshot
        )
        or (
          new.canonical_lexeme_id_snapshot is null
          and target.canonical_lexeme_id_snapshot is null
          and exists (
            select 1
            from public.vocab_entries as new_entry
            join public.vocab_entries as target_entry
              on target_entry.id = target.vocab_entry_id
              and target_entry.dataset_id = new_entry.dataset_id
            where new_entry.id = new.vocab_entry_id
              and new_entry.dataset_id = new.dataset_id
              and lower(trim(replace(
                target_entry.headword_normalized,
                '*',
                ''
              ))) = lower(trim(replace(
                new_entry.headword_normalized,
                '*',
                ''
              )))
          )
        )
      )
  ) then
    raise exception 'review_word_already_assigned'
      using errcode = '40001';
  end if;

  return new;
end;
$$;

create trigger assignment_review_targets_reject_duplicate_active
before insert on public.assignment_review_targets
for each row
execute function private.reject_duplicate_active_review_target();

revoke all on function private.reject_duplicate_active_review_target()
  from public, anon, authenticated, service_role;

-- Prevent an old mixed-assignment client or draft flow from consuming a queue
-- identity that already belongs to an active assignment.
create function private.reject_active_review_queue_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending'
    and new.status = 'consumed'
    and exists (
      select 1
      from public.assignment_review_targets as target
      where target.student_id = old.student_id
        and target.dataset_id = old.dataset_id
        and target.released_at is null
        and (
          target.vocab_entry_id = old.vocab_entry_id
          or (
            old.canonical_lexeme_id_snapshot is not null
            and target.canonical_lexeme_id_snapshot =
              old.canonical_lexeme_id_snapshot
          )
          or (
            old.canonical_lexeme_id_snapshot is null
            and target.canonical_lexeme_id_snapshot is null
            and exists (
              select 1
              from public.vocab_entries as old_entry
              join public.vocab_entries as target_entry
                on target_entry.id = target.vocab_entry_id
                and target_entry.dataset_id = old_entry.dataset_id
              where old_entry.id = old.vocab_entry_id
                and old_entry.dataset_id = old.dataset_id
                and lower(trim(replace(
                  target_entry.headword_normalized,
                  '*',
                  ''
                ))) = lower(trim(replace(
                  old_entry.headword_normalized,
                  '*',
                  ''
                )))
            )
          )
        )
    )
  then
    raise exception 'review_word_already_assigned'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

create trigger student_vocab_review_queue_reject_active_consumption
before update of status on public.student_vocab_review_queue
for each row
execute function private.reject_active_review_queue_consumption();

revoke all on function private.reject_active_review_queue_consumption()
  from public, anon, authenticated, service_role;

-- Make a wrong answer visible at the review screen and increment its state
-- exactly once for this attempt.
create or replace function
  private.record_initial_wrong_events_when_review_starts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  evaluation_time timestamptz :=
    coalesce(new.initial_completed_at, clock_timestamp());
begin
  perform private.record_wrong_events_for_attempt(
    new.id,
    new.student_id,
    evaluation_time
  );

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    unresolved_wrong_count,
    last_wrong_at,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  select
    new.student_id,
    question.vocab_entry_id,
    1,
    coalesce(question.initial_answered_at, evaluation_time),
    null,
    new.id,
    evaluation_time
  from public.quiz_questions as question
  where question.attempt_id = new.id
    and question.initial_is_correct is false
  on conflict (student_id, vocab_entry_id)
  do update set
    unresolved_wrong_count = case
      when public.student_vocab_state.last_attempt_id =
        excluded.last_attempt_id
        then greatest(
          public.student_vocab_state.unresolved_wrong_count,
          1
        )
      else public.student_vocab_state.unresolved_wrong_count + 1
    end,
    last_wrong_at = excluded.last_wrong_at,
    resolved_at = null,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at >=
    public.student_vocab_state.last_evaluated_at;

  update public.student_vocab_review_queue as queue
  set reason_level = least(
    2,
    greatest(
      1,
      (
      select count(distinct wrong_event.quiz_attempt_id)
      from public.student_vocab_wrong_events as wrong_event
      where wrong_event.student_id = new.student_id
        and wrong_event.wrong_stage = 'initial'
        and (
          (
            queue.canonical_lexeme_id_snapshot is not null
            and wrong_event.dataset_id = queue.dataset_id
            and wrong_event.canonical_lexeme_id_snapshot =
              queue.canonical_lexeme_id_snapshot
          )
          or (
            queue.canonical_lexeme_id_snapshot is null
            and wrong_event.dataset_id = queue.dataset_id
            and wrong_event.canonical_lexeme_id_snapshot is null
            and exists (
              select 1
              from public.vocab_entries as queue_entry
              join public.vocab_entries as wrong_entry
                on wrong_entry.id = wrong_event.vocab_entry_id
                and wrong_entry.dataset_id = queue_entry.dataset_id
              where queue_entry.id = queue.vocab_entry_id
                and queue_entry.dataset_id = queue.dataset_id
                and lower(trim(replace(
                  wrong_entry.headword_normalized,
                  '*',
                  ''
                ))) = lower(trim(replace(
                  queue_entry.headword_normalized,
                  '*',
                  ''
                )))
            )
          )
        )
      )
    )
  )::smallint
  where queue.student_id = new.student_id
    and queue.status = 'pending';

  return new;
end;
$$;

create function private.clamp_same_attempt_wrong_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_attempt_id = old.last_attempt_id
    and new.unresolved_wrong_count > old.unresolved_wrong_count
  then
    new.unresolved_wrong_count := old.unresolved_wrong_count;
  end if;
  return new;
end;
$$;

create trigger student_vocab_state_clamp_same_attempt_wrong_count
before update of unresolved_wrong_count, last_attempt_id
on public.student_vocab_state
for each row
execute function private.clamp_same_attempt_wrong_count();

revoke all on function private.clamp_same_attempt_wrong_count()
  from public, anon, authenticated, service_role;

-- A correct answer resolves the current word immediately, including when the
-- correct answer occurs in another assignment.
create function private.resolve_vocab_state_on_correct_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_student_id uuid;
  target_dataset_id uuid;
  target_canonical_id uuid;
  target_headword_key text;
  identity_is_resolved boolean;
  evaluated_at timestamptz := coalesce(
    new.retry_answered_at,
    new.initial_answered_at,
    clock_timestamp()
  );
begin
  select attempt.student_id
  into attempt_student_id
  from public.quiz_attempts as attempt
  where attempt.id = new.attempt_id;

  perform 1
  from public.students as student
  where student.id = attempt_student_id
  for update;

  select
    entry.dataset_id,
    coalesce(
      bank_question.canonical_lexeme_id_snapshot,
      current_identity.canonical_lexeme_id
    ),
    lower(trim(replace(
      coalesce(
        bank_question.headword_normalized_snapshot,
        entry.headword_normalized
      ),
      '*',
      ''
    )))
  into
    target_dataset_id,
    target_canonical_id,
    target_headword_key
  from public.vocab_entries as entry
  left join public.assignment_questions as bank_question
    on bank_question.id = new.assignment_question_id
  left join lateral (
    select min(eligibility.canonical_lexeme_id::text)::uuid
      as canonical_lexeme_id
    from public.vocab_entry_quiz_eligibility as eligibility
    where eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
  ) as current_identity on true
  where entry.id = new.vocab_entry_id;

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    unresolved_wrong_count,
    last_wrong_at,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  values (
    attempt_student_id,
    new.vocab_entry_id,
    0,
    null,
    evaluated_at,
    new.attempt_id,
    evaluated_at
  )
  on conflict (student_id, vocab_entry_id)
  do update set
    unresolved_wrong_count = 0,
    resolved_at = excluded.resolved_at,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at >=
    public.student_vocab_state.last_evaluated_at;

  -- Resolve every occurrence of the same canonical word in this textbook,
  -- but never let a late answer overwrite a newer wrong-state evaluation.
  update public.student_vocab_state as state
  set
    unresolved_wrong_count = 0,
    resolved_at = evaluated_at,
    last_attempt_id = new.attempt_id,
    last_evaluated_at = evaluated_at
  from public.vocab_entries as entry
  where state.student_id = attempt_student_id
    and entry.id = state.vocab_entry_id
    and entry.dataset_id = target_dataset_id
    and evaluated_at >= state.last_evaluated_at
    and (
      state.vocab_entry_id = new.vocab_entry_id
      or (
        target_canonical_id is not null
        and exists (
          select 1
          from public.vocab_entry_quiz_eligibility as eligibility
          where eligibility.vocab_entry_id = state.vocab_entry_id
            and eligibility.dataset_id = target_dataset_id
            and eligibility.status = 'eligible'
            and eligibility.canonical_lexeme_id =
              target_canonical_id
        )
      )
      or (
        target_canonical_id is null
        and lower(trim(replace(
          entry.headword_normalized,
          '*',
          ''
        ))) = target_headword_key
        and not exists (
          select 1
          from public.vocab_entry_quiz_eligibility as eligibility
          where eligibility.vocab_entry_id = state.vocab_entry_id
            and eligibility.dataset_id = target_dataset_id
            and eligibility.status = 'eligible'
            and eligibility.canonical_lexeme_id is not null
        )
      )
    );

  select not exists (
    select 1
    from public.student_vocab_state as state
    join public.vocab_entries as entry
      on entry.id = state.vocab_entry_id
      and entry.dataset_id = target_dataset_id
    where state.student_id = attempt_student_id
      and state.unresolved_wrong_count > 0
      and (
        state.vocab_entry_id = new.vocab_entry_id
        or (
          target_canonical_id is not null
          and exists (
            select 1
            from public.vocab_entry_quiz_eligibility as eligibility
            where eligibility.vocab_entry_id = state.vocab_entry_id
              and eligibility.dataset_id = target_dataset_id
              and eligibility.status = 'eligible'
              and eligibility.canonical_lexeme_id =
                target_canonical_id
          )
        )
        or (
          target_canonical_id is null
          and lower(trim(replace(
            entry.headword_normalized,
            '*',
            ''
          ))) = target_headword_key
          and not exists (
            select 1
            from public.vocab_entry_quiz_eligibility as eligibility
            where eligibility.vocab_entry_id = state.vocab_entry_id
              and eligibility.dataset_id = target_dataset_id
              and eligibility.status = 'eligible'
              and eligibility.canonical_lexeme_id is not null
          )
        )
      )
  )
  into identity_is_resolved;

  update public.student_vocab_review_queue as queue
  set
    status = 'cancelled',
    cancelled_at = evaluated_at,
    consumed_assignment_id = null,
    consumed_at = null,
    reserved_review_draft_id = null,
    reserved_at = null
  where queue.student_id = attempt_student_id
    and queue.dataset_id = target_dataset_id
    and queue.status in ('pending', 'consumed')
    and identity_is_resolved
    and (
      queue.vocab_entry_id = new.vocab_entry_id
      or (
        target_canonical_id is not null
        and queue.canonical_lexeme_id_snapshot = target_canonical_id
      )
      or (
        target_canonical_id is null
        and queue.canonical_lexeme_id_snapshot is null
        and exists (
          select 1
          from public.vocab_entries as queue_entry
          where queue_entry.id = queue.vocab_entry_id
            and queue_entry.dataset_id = target_dataset_id
            and lower(trim(replace(
              queue_entry.headword_normalized,
              '*',
              ''
            ))) = target_headword_key
        )
      )
    );

  update public.assignment_review_targets as target
  set
    released_at = evaluated_at,
    release_reason = 'resolved'
  where target.student_id = attempt_student_id
    and target.dataset_id = target_dataset_id
    and target.released_at is null
    and identity_is_resolved
    and (
      target.vocab_entry_id = new.vocab_entry_id
      or (
        target_canonical_id is not null
        and target.canonical_lexeme_id_snapshot =
          target_canonical_id
      )
      or (
        target_canonical_id is null
        and target.canonical_lexeme_id_snapshot is null
        and exists (
          select 1
          from public.vocab_entries as target_entry
          where target_entry.id = target.vocab_entry_id
            and target_entry.dataset_id = target_dataset_id
            and lower(trim(replace(
              target_entry.headword_normalized,
              '*',
              ''
            ))) = target_headword_key
        )
      )
    );

  return new;
end;
$$;

create trigger quiz_questions_resolve_vocab_state_on_correct
after update of initial_is_correct, retry_is_correct
on public.quiz_questions
for each row
when (
  (
    new.initial_is_correct is true
    and old.initial_is_correct is distinct from true
  )
  or (
    new.retry_is_correct is true
    and old.retry_is_correct is distinct from true
  )
)
execute function private.resolve_vocab_state_on_correct_answer();

revoke all on function private.resolve_vocab_state_on_correct_answer()
  from public, anon, authenticated, service_role;

-- Once an attempt is terminal, the active link is released. Unresolved queue
-- state remains pending; correct words remain cancelled.
create function private.release_review_targets_on_attempt_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.student_vocab_review_queue as queue
  set
    status = 'cancelled',
    cancelled_at = coalesce(new.completed_at, clock_timestamp()),
    consumed_assignment_id = null,
    consumed_at = null,
    reserved_review_draft_id = null,
    reserved_at = null
  where queue.id in (
    select target.review_queue_id
    from public.assignment_review_targets as target
    join public.quiz_questions as question
      on question.attempt_id = new.id
      and question.vocab_entry_id = target.vocab_entry_id
    where target.assignment_id = new.assignment_id
      and target.student_id = new.student_id
      and target.released_at is null
      and (
        question.initial_is_correct is true
        or question.retry_is_correct is true
      )
  )
    and queue.status = 'pending';

  update public.assignment_review_targets as target
  set
    released_at = coalesce(new.completed_at, clock_timestamp()),
    release_reason = case
      when exists (
        select 1
        from public.quiz_questions as question
        where question.attempt_id = new.id
          and question.vocab_entry_id = target.vocab_entry_id
          and (
            question.initial_is_correct is true
            or question.retry_is_correct is true
          )
      ) then 'resolved'
      else 'completed_unresolved'
    end
  where target.assignment_id = new.assignment_id
    and target.student_id = new.student_id
    and target.released_at is null;

  return new;
end;
$$;

create trigger quiz_attempts_release_review_targets
after update of status on public.quiz_attempts
for each row
when (
  old.status = 'in_progress'
  and new.status in ('completed', 'expired')
)
execute function private.release_review_targets_on_attempt_terminal();

revoke all on function private.release_review_targets_on_attempt_terminal()
  from public, anon, authenticated, service_role;

-- Queue selection now also accepts the explicit review phase, which makes the
-- last freshly wrong row selectable before the student chooses a retry.
create or replace function private.queue_student_vocab_review_words(
  p_student_id uuid,
  p_question_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected record;
  existing_queue_id uuid;
  queued_ids uuid[] := array[]::uuid[];
  selected_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_question_ids is null
    or cardinality(p_question_ids) not between 1 and 500
    or cardinality(p_question_ids) <> (
      select count(distinct question_id)
      from unnest(p_question_ids) as input(question_id)
      where question_id is not null
    )
  then
    raise exception 'invalid_review_question_selection'
      using errcode = '22023';
  end if;

  perform 1
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
  for update;
  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  select count(*)
  into selected_count
  from public.quiz_questions as question
  join public.quiz_attempts as attempt
    on attempt.id = question.attempt_id
  join public.student_vocab_state as state
    on state.student_id = attempt.student_id
    and state.vocab_entry_id = question.vocab_entry_id
  where question.id = any(p_question_ids)
    and attempt.student_id = p_student_id
    and (
      attempt.status in ('completed', 'expired')
      or (
        attempt.status = 'in_progress'
        and attempt.phase in ('review', 'retry')
      )
    )
    and question.initial_is_correct is false
    and question.retry_is_correct is distinct from true
    and state.unresolved_wrong_count > 0
    and exists (
      select 1
      from public.student_vocab_wrong_events as wrong_event
      where wrong_event.quiz_question_id = question.id
        and wrong_event.wrong_stage = 'initial'
    );

  if selected_count <> cardinality(p_question_ids) then
    raise exception 'review_question_not_available'
      using errcode = '22023';
  end if;

  for selected in
    select
      question.id as question_id,
      question.attempt_id,
      question.vocab_entry_id,
      entry.dataset_id,
      entry.headword_normalized,
      min(wrong_event.canonical_lexeme_id_snapshot::text)::uuid
        as canonical_lexeme_id_snapshot,
      least(
        2,
        count(distinct history.quiz_attempt_id) filter (
          where history.wrong_stage = 'initial'
        )
      )::smallint as reason_level
    from public.quiz_questions as question
    join public.quiz_attempts as attempt
      on attempt.id = question.attempt_id
    join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
    join public.student_vocab_wrong_events as wrong_event
      on wrong_event.quiz_question_id = question.id
      and wrong_event.wrong_stage = 'initial'
    join public.student_vocab_wrong_events as history
      on history.student_id = p_student_id
      and history.dataset_id = entry.dataset_id
    join public.vocab_entries as history_entry
      on history_entry.id = history.vocab_entry_id
      and (
        (
          wrong_event.canonical_lexeme_id_snapshot is not null
          and history.canonical_lexeme_id_snapshot =
            wrong_event.canonical_lexeme_id_snapshot
        )
        or (
          wrong_event.canonical_lexeme_id_snapshot is null
          and history.canonical_lexeme_id_snapshot is null
          and lower(trim(replace(
            history_entry.headword_normalized,
            '*',
            ''
          ))) = lower(trim(replace(
            entry.headword_normalized,
            '*',
            ''
          )))
        )
      )
    where question.id = any(p_question_ids)
      and attempt.student_id = p_student_id
    group by
      question.id,
      question.attempt_id,
      question.vocab_entry_id,
      entry.dataset_id,
      entry.headword_normalized
    order by question.id
  loop
    select queue.id
    into existing_queue_id
    from public.student_vocab_review_queue as queue
    join public.vocab_entries as queue_entry
      on queue_entry.id = queue.vocab_entry_id
      and queue_entry.dataset_id = queue.dataset_id
    where queue.student_id = p_student_id
      and queue.dataset_id = selected.dataset_id
      and queue.status = 'pending'
      and (
        queue.vocab_entry_id = selected.vocab_entry_id
        or (
          selected.canonical_lexeme_id_snapshot is not null
          and queue.canonical_lexeme_id_snapshot =
            selected.canonical_lexeme_id_snapshot
        )
        or (
          selected.canonical_lexeme_id_snapshot is null
          and queue.canonical_lexeme_id_snapshot is null
          and lower(trim(replace(
            queue_entry.headword_normalized,
            '*',
            ''
          ))) = lower(trim(replace(
            selected.headword_normalized,
            '*',
            ''
          )))
        )
      )
    order by queue.queued_at desc, queue.id
    limit 1
    for update;

    if existing_queue_id is null then
      insert into public.student_vocab_review_queue (
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_lexeme_id_snapshot,
        source_attempt_id,
        source_question_id,
        reason_level,
        queued_by
      )
      values (
        p_student_id,
        selected.dataset_id,
        selected.vocab_entry_id,
        selected.canonical_lexeme_id_snapshot,
        selected.attempt_id,
        selected.question_id,
        greatest(selected.reason_level, 1),
        (select auth.uid())
      )
      returning id into existing_queue_id;
    else
      update public.student_vocab_review_queue
      set
        source_attempt_id = selected.attempt_id,
        source_question_id = selected.question_id,
        reason_level = greatest(
          reason_level,
          selected.reason_level,
          1
        )
      where id = existing_queue_id;
    end if;

    if array_position(queued_ids, existing_queue_id) is null then
      queued_ids := array_append(queued_ids, existing_queue_id);
    end if;
  end loop;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'student.review_queue.words_queued',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'questionCount', cardinality(p_question_ids),
      'queueCount', cardinality(queued_ids),
      'queueIds', to_jsonb(queued_ids)
    )
  );

  return queued_ids;
end;
$$;

-- Both regular and mixed assignment creators call this after locking every
-- target student. The check covers the complete question bank, not only words
-- that originated in the wrong-word queue.
create function private.assert_assignment_words_available_v1(
  p_student_ids uuid[],
  p_dataset_id uuid,
  p_questions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_student_ids is null
    or cardinality(p_student_ids) < 1
    or p_dataset_id is null
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
  then
    raise exception 'invalid_assignment_word_check'
      using errcode = '22023';
  end if;

  if exists (
    with identity_by_entry as materialized (
      select
        entry.id as vocab_entry_id,
        min(eligibility.canonical_lexeme_id::text)::uuid
          as canonical_lexeme_id,
        lower(trim(replace(entry.headword_normalized, '*', '')))
          as headword_key
      from public.vocab_entries as entry
      left join public.vocab_entry_quiz_eligibility as eligibility
        on eligibility.vocab_entry_id = entry.id
        and eligibility.dataset_id = entry.dataset_id
        and eligibility.status = 'eligible'
      where entry.dataset_id = p_dataset_id
      group by entry.id, entry.headword_normalized
    ),
    incoming_words as materialized (
      select distinct
        plan.vocab_entry_id,
        identity.canonical_lexeme_id,
        identity.headword_key
      from jsonb_to_recordset(p_questions) as plan(
        vocab_entry_id bigint
      )
      left join identity_by_entry as identity
        on identity.vocab_entry_id = plan.vocab_entry_id
    ),
    active_words as materialized (
      select
        link.student_id,
        question.vocab_entry_id,
        coalesce(
          question.canonical_lexeme_id_snapshot,
          identity.canonical_lexeme_id
        ) as canonical_lexeme_id,
        lower(trim(replace(
          coalesce(
            question.headword_normalized_snapshot,
            identity.headword_key
          ),
          '*',
          ''
        ))) as headword_key
      from public.assignment_students as link
      join public.assignments as assignment
        on assignment.id = link.assignment_id
        and assignment.dataset_id = p_dataset_id
        and assignment.status <> 'closed'
      join public.assignment_questions as question
        on question.assignment_id = link.assignment_id
      left join identity_by_entry as identity
        on identity.vocab_entry_id = question.vocab_entry_id
      where link.student_id = any(p_student_ids)
        and link.cancelled_at is null
        and link.missed_at is null
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
    )
    select 1
    from active_words as active
    join incoming_words as incoming
      on incoming.vocab_entry_id = active.vocab_entry_id
      or (
        incoming.canonical_lexeme_id is not null
        and incoming.canonical_lexeme_id =
          active.canonical_lexeme_id
      )
      or (
        incoming.canonical_lexeme_id is null
        and active.canonical_lexeme_id is null
        and incoming.headword_key is not null
        and incoming.headword_key = active.headword_key
      )
  ) then
    raise exception 'assignment_word_already_active'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function private.assert_assignment_words_available_v1(
  uuid[], uuid, jsonb
) from public, anon, authenticated, service_role;

-- If a regular assignment happens to contain a pending wrong word, attach the
-- queue row to that assignment without consuming it. The wrong-word list can
-- therefore show "assigned" and cancellation immediately returns it to
-- "waiting".
create function private.link_pending_review_targets_v1(
  p_assignment_id uuid,
  p_student_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_count integer;
begin
  insert into public.assignment_review_targets (
    assignment_id,
    student_id,
    review_queue_id,
    assignment_question_id,
    dataset_id,
    vocab_entry_id,
    canonical_lexeme_id_snapshot
  )
  select
    p_assignment_id,
    link.student_id,
    selected_queue.id,
    question.id,
    question.dataset_id,
    selected_queue.vocab_entry_id,
    coalesce(
      question.canonical_lexeme_id_snapshot,
      selected_queue.canonical_lexeme_id_snapshot
    )
  from public.assignment_students as link
  join public.assignment_questions as question
    on question.assignment_id = link.assignment_id
  join public.vocab_entries as question_entry
    on question_entry.id = question.vocab_entry_id
    and question_entry.dataset_id = question.dataset_id
  join lateral (
    select queue.*
    from public.student_vocab_review_queue as queue
    join public.vocab_entries as queue_entry
      on queue_entry.id = queue.vocab_entry_id
      and queue_entry.dataset_id = queue.dataset_id
    where queue.student_id = link.student_id
      and queue.dataset_id = question.dataset_id
      and queue.status = 'pending'
      and queue.reserved_review_draft_id is null
      and (
        queue.vocab_entry_id = question.vocab_entry_id
        or (
          question.canonical_lexeme_id_snapshot is not null
          and queue.canonical_lexeme_id_snapshot =
            question.canonical_lexeme_id_snapshot
        )
        or (
          question.canonical_lexeme_id_snapshot is null
          and queue.canonical_lexeme_id_snapshot is null
          and lower(trim(replace(
            queue_entry.headword_normalized,
            '*',
            ''
          ))) = lower(trim(replace(
            coalesce(
              question.headword_normalized_snapshot,
              question_entry.headword_normalized
            ),
            '*',
            ''
          )))
        )
      )
    order by queue.reason_level desc, queue.queued_at, queue.id
    limit 1
  ) as selected_queue on true
  where link.assignment_id = p_assignment_id
    and link.student_id = any(p_student_ids)
    and link.cancelled_at is null
    and link.missed_at is null
    and not exists (
      select 1
      from public.assignment_review_targets as existing
      where existing.assignment_id = p_assignment_id
        and existing.student_id = link.student_id
        and existing.released_at is null
        and (
          existing.assignment_question_id = question.id
          or existing.vocab_entry_id = question.vocab_entry_id
          or (
            question.canonical_lexeme_id_snapshot is not null
            and existing.canonical_lexeme_id_snapshot =
              question.canonical_lexeme_id_snapshot
          )
        )
    )
  order by link.student_id, question.base_order_index
  on conflict (assignment_id, student_id, review_queue_id) do nothing;

  get diagnostics linked_count = row_count;
  return linked_count;
end;
$$;

revoke all on function private.link_pending_review_targets_v1(
  uuid, uuid[]
) from public, anon, authenticated, service_role;

-- Regular assignment persistence and delivery settings are one transaction.
-- Student locks serialize regular and mixed creators, so their duplicate
-- checks cannot race each other.
create function private.create_assignment_with_delivery_v4(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
  locked_student_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_ids is null
    or cardinality(p_student_ids) < 1
    or cardinality(p_student_ids) <> (
      select count(distinct student_id)
      from unnest(p_student_ids) as input(student_id)
      where student_id is not null
    )
  then
    raise exception 'invalid_assignment_students'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = any(p_student_ids)
    and student.status = 'active'
  order by student.id
  for update;

  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(p_student_ids)
    and student.status = 'active';
  if locked_student_count <> cardinality(p_student_ids) then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  perform private.assert_assignment_words_available_v1(
    p_student_ids,
    p_dataset_id,
    p_questions
  );

  created_assignment_id := private.create_assignment_with_question_bank_v3(
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_questions
  );

  perform private.configure_assignment_delivery_v1(
    created_assignment_id,
    p_timing_mode,
    p_question_time_limit_seconds
  );
  perform private.link_pending_review_targets_v1(
    created_assignment_id,
    p_student_ids
  );

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.regular_v4_created',
    (select auth.uid()),
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'studentIds', to_jsonb(p_student_ids),
      'timingMode', p_timing_mode
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_assignment_with_delivery_v4(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_assignment_with_delivery_v4(
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
$$;

revoke all on function private.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon;
grant execute on function private.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;
revoke all on function public.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon;
grant execute on function public.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;

-- New mixed creation removes the browser-provided count limit. It compares the
-- entire selected-level queue snapshot, persists questions, records active
-- links, restores queue rows to pending, and configures timing in one DB
-- transaction.
create function private.create_mixed_review_assignment_v6(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_queue_ids uuid[];
  created_assignment_id uuid;
  inserted_target_count integer;
  restored_queue_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_review_levels is null
    or cardinality(p_review_levels) not between 1 and 2
    or cardinality(p_review_levels) <> (
      select count(distinct level)
      from unnest(p_review_levels) as input(level)
      where level in (1, 2)
    )
    or p_selected_queue_ids is null
    or cardinality(p_selected_queue_ids) not between 1 and 500
    or cardinality(p_selected_queue_ids) <> (
      select count(distinct queue_id)
      from unnest(p_selected_queue_ids) as input(queue_id)
      where queue_id is not null
    )
  then
    raise exception 'invalid_mixed_review_selection'
      using errcode = '22023';
  end if;

  perform 1
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
  for update;
  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  perform private.assert_assignment_words_available_v1(
    array[p_student_id],
    p_dataset_id,
    p_questions
  );

  with identity_by_entry as materialized (
    select
      entry.id as vocab_entry_id,
      min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id,
      lower(trim(replace(entry.headword_normalized, '*', '')))
        as headword_key
    from public.vocab_entries as entry
    left join public.vocab_entry_quiz_eligibility as eligibility
      on eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
    where entry.dataset_id = p_dataset_id
    group by entry.id, entry.headword_normalized
  ),
  active_words as materialized (
    select
      question.vocab_entry_id,
      coalesce(
        question.canonical_lexeme_id_snapshot,
        identity.canonical_lexeme_id
      ) as canonical_lexeme_id,
      lower(trim(replace(
        coalesce(
          question.headword_normalized_snapshot,
          identity.headword_key
        ),
        '*',
        ''
      ))) as headword_key
    from public.assignment_students as link
    join public.assignments as assignment
      on assignment.id = link.assignment_id
      and assignment.dataset_id = p_dataset_id
      and assignment.status <> 'closed'
    join public.assignment_questions as question
      on question.assignment_id = link.assignment_id
    left join identity_by_entry as identity
      on identity.vocab_entry_id = question.vocab_entry_id
    where link.student_id = p_student_id
      and link.cancelled_at is null
      and link.missed_at is null
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
  ),
  ranked_queue as materialized (
    select
      queue.id,
      queue.reason_level,
      queue.queued_at,
      row_number() over (
        partition by coalesce(
          identity.canonical_lexeme_id::text,
          'headword:' || identity.headword_key,
          'entry:' || queue.vocab_entry_id::text
        )
        order by
          queue.reason_level desc,
          queue.queued_at,
          queue.id
      ) as identity_rank
    from public.student_vocab_review_queue as queue
    left join identity_by_entry as identity
      on identity.vocab_entry_id = queue.vocab_entry_id
    where queue.student_id = p_student_id
      and queue.dataset_id = p_dataset_id
      and queue.status = 'pending'
      and queue.reserved_review_draft_id is null
      and queue.reason_level = any(p_review_levels)
      and not exists (
        select 1
        from active_words as active
        where active.vocab_entry_id = queue.vocab_entry_id
          or (
            identity.canonical_lexeme_id is not null
            and identity.canonical_lexeme_id =
              active.canonical_lexeme_id
          )
          or (
            identity.canonical_lexeme_id is null
            and active.canonical_lexeme_id is null
            and identity.headword_key is not null
            and identity.headword_key = active.headword_key
          )
      )
  ),
  selected_queue as materialized (
    select
      ranked.id,
      ranked.reason_level,
      ranked.queued_at
    from ranked_queue as ranked
    where ranked.identity_rank = 1
    order by ranked.reason_level desc, ranked.queued_at, ranked.id
    limit 500
  )
  select coalesce(
    array_agg(
      selected.id
      order by selected.reason_level desc, selected.queued_at, selected.id
    ),
    array[]::uuid[]
  )
  into current_queue_ids
  from selected_queue as selected;

  if cardinality(current_queue_ids) = 0 then
    raise exception 'mixed_review_queue_empty' using errcode = '22023';
  end if;
  if current_queue_ids is distinct from p_selected_queue_ids then
    raise exception 'mixed_review_queue_snapshot_changed'
      using errcode = '40001';
  end if;

  created_assignment_id := private.persist_review_assignment_v5(
    p_student_id,
    p_dataset_id,
    current_queue_ids,
    null,
    p_title,
    p_primary_unit_ids,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_questions
  );

  if jsonb_array_length(p_questions) = cardinality(current_queue_ids) then
    update public.assignments
    set assignment_purpose = 'review'
    where id = created_assignment_id;

    update public.assignment_units
    set is_primary = false
    where assignment_id = created_assignment_id;
  end if;

  insert into public.assignment_review_targets (
    assignment_id,
    student_id,
    review_queue_id,
    assignment_question_id,
    dataset_id,
    vocab_entry_id,
    canonical_lexeme_id_snapshot
  )
  select
    created_assignment_id,
    p_student_id,
    queue.id,
    question.id,
    queue.dataset_id,
    queue.vocab_entry_id,
    queue.canonical_lexeme_id_snapshot
  from unnest(current_queue_ids) with ordinality
    as selected(queue_id, position)
  join public.student_vocab_review_queue as queue
    on queue.id = selected.queue_id
  join public.assignment_questions as question
    on question.assignment_id = created_assignment_id
    and question.vocab_entry_id = queue.vocab_entry_id
  order by selected.position;

  get diagnostics inserted_target_count = row_count;
  if inserted_target_count <> cardinality(current_queue_ids) then
    raise exception 'assignment_review_target_insert_mismatch'
      using errcode = '21000';
  end if;

  update public.student_vocab_review_queue as queue
  set
    status = 'pending',
    consumed_assignment_id = null,
    consumed_at = null,
    cancelled_at = null,
    reserved_review_draft_id = null,
    reserved_at = null
  where queue.id = any(current_queue_ids)
    and queue.status = 'consumed'
    and queue.consumed_assignment_id = created_assignment_id;

  get diagnostics restored_queue_count = row_count;
  if restored_queue_count <> cardinality(current_queue_ids) then
    raise exception 'assignment_review_queue_restore_mismatch'
      using errcode = '40001';
  end if;

  perform private.link_pending_review_targets_v1(
    created_assignment_id,
    array[p_student_id]
  );

  perform private.configure_assignment_delivery_v1(
    created_assignment_id,
    p_timing_mode,
    p_question_time_limit_seconds
  );

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.mixed_review_v6_created',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'reviewLevels', to_jsonb(p_review_levels),
      'selectedQueueIds', to_jsonb(current_queue_ids),
      'timingMode', p_timing_mode
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_mixed_review_assignment_v6(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_mixed_review_assignment_v6(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_selected_queue_ids,
    p_title,
    p_primary_unit_ids,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
$$;

revoke all on function private.create_mixed_review_assignment_v6(
  uuid,
  uuid,
  smallint[],
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  text,
  integer,
  jsonb
) from public, anon;
grant execute on function private.create_mixed_review_assignment_v6(
  uuid,
  uuid,
  smallint[],
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  text,
  integer,
  jsonb
) to authenticated, service_role;

revoke all on function public.create_mixed_review_assignment_v6(
  uuid,
  uuid,
  smallint[],
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  text,
  integer,
  jsonb
) from public, anon;
grant execute on function public.create_mixed_review_assignment_v6(
  uuid,
  uuid,
  smallint[],
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  text,
  integer,
  jsonb
) to authenticated, service_role;

-- Cancellation is recipient-specific and refuses every assignment that has
-- any attempt history, including an attempt racing the button click.
create function private.cancel_student_assignment_v1(
  p_assignment_id uuid,
  p_student_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_missed_at timestamptz;
  link_cancelled_at timestamptz;
  cancellation_time timestamptz := clock_timestamp();
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_assignment_id is null
    or p_student_id is null
    or p_reason is null
    or char_length(trim(p_reason)) not between 1 and 500
  then
    raise exception 'invalid_assignment_cancel_input'
      using errcode = '22023';
  end if;

  perform 1
  from public.students as student
  where student.id = p_student_id
  for update;
  if not found then
    raise exception 'assignment_student_not_found'
      using errcode = 'P0002';
  end if;

  select link.missed_at, link.cancelled_at
  into link_missed_at, link_cancelled_at
  from public.assignment_students as link
  where link.assignment_id = p_assignment_id
    and link.student_id = p_student_id
  for update;
  if not found then
    raise exception 'assignment_student_not_found'
      using errcode = 'P0002';
  end if;

  if link_cancelled_at is not null then
    return jsonb_build_object(
      'status', 'cancelled',
      'assignmentId', p_assignment_id,
      'studentId', p_student_id
    );
  end if;
  if link_missed_at is not null then
    raise exception 'assignment_already_missed'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.assignment_id = p_assignment_id
      and attempt.student_id = p_student_id
  ) then
    raise exception 'assignment_already_started'
      using errcode = '22023';
  end if;

  update public.assignment_students
  set
    cancelled_at = cancellation_time,
    cancelled_by = (select auth.uid()),
    cancellation_reason = trim(p_reason)
  where assignment_id = p_assignment_id
    and student_id = p_student_id;

  update public.assignment_review_targets
  set
    released_at = cancellation_time,
    release_reason = 'cancelled'
  where assignment_id = p_assignment_id
    and student_id = p_student_id
    and released_at is null;

  update public.assignments as assignment
  set status = 'closed'
  where assignment.id = p_assignment_id
    and not exists (
      select 1
      from public.assignment_students as link
      where link.assignment_id = assignment.id
        and link.cancelled_at is null
        and link.missed_at is null
    );

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.student.cancelled',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', p_assignment_id,
      'cancelledAt', cancellation_time,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'status', 'cancelled',
    'assignmentId', p_assignment_id,
    'studentId', p_student_id
  );
end;
$$;

create function public.cancel_student_assignment_v1(
  p_assignment_id uuid,
  p_student_id uuid,
  p_reason text default '관리자 취소'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_student_assignment_v1(
    p_assignment_id,
    p_student_id,
    p_reason
  );
$$;

revoke all on function private.cancel_student_assignment_v1(
  uuid,
  uuid,
  text
) from public, anon;
grant execute on function private.cancel_student_assignment_v1(
  uuid,
  uuid,
  text
) to authenticated, service_role;
revoke all on function public.cancel_student_assignment_v1(
  uuid,
  uuid,
  text
) from public, anon;
grant execute on function public.cancel_student_assignment_v1(
  uuid,
  uuid,
  text
) to authenticated, service_role;

create or replace function private.reject_attempt_for_missed_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_missed_at timestamptz;
  recorded_cancelled_at timestamptz;
  assignment_deadline timestamptz;
begin
  perform 1
  from public.students as student
  where student.id = new.student_id
  for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  select
    link.missed_at,
    link.cancelled_at,
    assignment.available_until
  into
    recorded_missed_at,
    recorded_cancelled_at,
    assignment_deadline
  from public.assignment_students as link
  join public.assignments as assignment
    on assignment.id = link.assignment_id
  where link.assignment_id = new.assignment_id
    and link.student_id = new.student_id
  for update of link;

  if not found then
    raise exception 'assignment_not_owned' using errcode = '42501';
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
    where link.missed_at is null
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
    if current_deadline is null
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

-- Current summary is based on state, not immutable historical event presence.
create or replace function
  public.list_student_current_vocab_wrong_summaries(
    p_after_student_id uuid default null,
    p_limit integer default 500
  )
returns table (
  student_id uuid,
  dataset_id uuid,
  wrong_word_count integer,
  repeated_wrong_word_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid_current_vocab_wrong_summary_cursor'
      using errcode = '22023';
  end if;

  return query
  with page_students as materialized (
    select
      student.id,
      student.current_vocab_dataset_id as dataset_id
    from public.students as student
    where student.status = 'active'
      and student.current_vocab_dataset_id is not null
      and (
        p_after_student_id is null
        or student.id > p_after_student_id
      )
    order by student.id
    limit p_limit
  ),
  identity_by_entry as (
    select
      entry.id as vocab_entry_id,
      min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id,
      lower(trim(replace(entry.headword_normalized, '*', '')))
        as headword_key
    from public.vocab_entries as entry
    left join public.vocab_entry_quiz_eligibility as eligibility
      on eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
    group by entry.id, entry.headword_normalized
  ),
  unresolved as (
    select
      student.id as student_id,
      student.dataset_id,
      state.vocab_entry_id,
      identity.canonical_lexeme_id,
      identity.headword_key,
      case
        when identity.canonical_lexeme_id is not null
          then 'canonical:' || identity.canonical_lexeme_id::text
        else 'headword:' || identity.headword_key
      end as word_key
    from page_students as student
    join public.student_vocab_state as state
      on state.student_id = student.id
      and state.unresolved_wrong_count > 0
    join public.vocab_entries as entry
      on entry.id = state.vocab_entry_id
      and entry.dataset_id = student.dataset_id
    left join identity_by_entry as identity
      on identity.vocab_entry_id = state.vocab_entry_id
  ),
  word_counts as (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key,
      count(distinct wrong_event.quiz_attempt_id) filter (
        where wrong_event.wrong_stage = 'initial'
      ) as wrong_count
    from unresolved
    left join public.student_vocab_wrong_events as wrong_event
      on wrong_event.student_id = unresolved.student_id
      and (
        (
          unresolved.canonical_lexeme_id is not null
          and wrong_event.dataset_id = unresolved.dataset_id
          and wrong_event.canonical_lexeme_id_snapshot =
            unresolved.canonical_lexeme_id
        )
        or (
          unresolved.canonical_lexeme_id is null
          and wrong_event.dataset_id = unresolved.dataset_id
          and wrong_event.canonical_lexeme_id_snapshot is null
          and exists (
            select 1
            from public.vocab_entries as wrong_entry
            where wrong_entry.id = wrong_event.vocab_entry_id
              and wrong_entry.dataset_id = unresolved.dataset_id
              and lower(trim(replace(
                wrong_entry.headword_normalized,
                '*',
                ''
              ))) = unresolved.headword_key
          )
        )
      )
    group by
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key
  )
  select
    student.id,
    student.dataset_id,
    count(word.word_key)::integer,
    count(word.word_key) filter (
      where word.wrong_count >= 2
    )::integer
  from page_students as student
  left join word_counts as word
    on word.student_id = student.id
    and word.dataset_id = student.dataset_id
  group by student.id, student.dataset_id
  order by student.id;
end;
$$;

-- Record the exact end of the database cutover. The emergency rollback may
-- only run while no lifecycle row has changed after this timestamp.
insert into private.app_migration_snapshots (
  snapshot_id,
  table_name,
  captured_at,
  rows,
  row_count
)
values (
  'wrong_assignment_lifecycle_20260730',
  'cutover',
  clock_timestamp(),
  '[]'::jsonb,
  0
)
on conflict (snapshot_id, table_name) do update
set
  captured_at = excluded.captured_at,
  rows = excluded.rows,
  row_count = excluded.row_count;

notify pgrst, 'reload schema';

commit;
