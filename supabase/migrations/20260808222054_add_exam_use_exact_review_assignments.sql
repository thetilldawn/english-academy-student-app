begin;

do $$
begin
  if to_regprocedure(
    'private.create_assignment_with_delivery_v5(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)'
  ) is null
    or to_regprocedure(
      'private.create_mixed_review_assignment_v7(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)'
    ) is null
    or to_regprocedure(
      'private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'
    ) is null
    or to_regprocedure(
      'private.replace_student_assignment_v2(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)'
    ) is null
  then
    raise exception 'exam_use_exact_review_prerequisite_missing';
  end if;
end;
$$;

-- Keep the immutable exam-use identity beside every wrong-answer lifecycle
-- row. Legacy UUID datasets intentionally keep these columns null.
alter table public.student_vocab_wrong_events
  add column canonical_dictionary_id_snapshot text,
  add column exam_use_release_id_snapshot uuid,
  add column occurrence_id_snapshot text;

alter table public.student_vocab_state
  add column canonical_dictionary_id_snapshot text;

alter table public.student_vocab_review_queue
  add column canonical_dictionary_id_snapshot text,
  add column source_exam_use_release_id_snapshot uuid,
  add column source_occurrence_id_snapshot text;

alter table public.assignment_review_targets
  add column canonical_dictionary_id_snapshot text;

alter table public.student_vocab_wrong_events
  add constraint student_vocab_wrong_events_dictionary_id_check check (
    canonical_dictionary_id_snapshot is null
    or canonical_dictionary_id_snapshot ~
      '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  ),
  add constraint student_vocab_wrong_events_occurrence_id_check check (
    occurrence_id_snapshot is null
    or occurrence_id_snapshot ~ '^occ:[a-z0-9][a-z0-9._-]*$'
  ),
  add constraint student_vocab_wrong_events_exam_use_tuple_check check (
    (canonical_dictionary_id_snapshot is null
      and exam_use_release_id_snapshot is null
      and occurrence_id_snapshot is null)
    or (canonical_dictionary_id_snapshot is not null
      and exam_use_release_id_snapshot is not null
      and occurrence_id_snapshot is not null)
  );

alter table public.student_vocab_state
  add constraint student_vocab_state_dictionary_id_check check (
    canonical_dictionary_id_snapshot is null
    or canonical_dictionary_id_snapshot ~
      '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  );

alter table public.student_vocab_review_queue
  add constraint student_vocab_review_queue_dictionary_id_check check (
    canonical_dictionary_id_snapshot is null
    or canonical_dictionary_id_snapshot ~
      '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  ),
  add constraint student_vocab_review_queue_occurrence_id_check check (
    source_occurrence_id_snapshot is null
    or source_occurrence_id_snapshot ~ '^occ:[a-z0-9][a-z0-9._-]*$'
  ),
  add constraint student_vocab_review_queue_exam_use_tuple_check check (
    (canonical_dictionary_id_snapshot is null
      and source_exam_use_release_id_snapshot is null
      and source_occurrence_id_snapshot is null)
    or (canonical_dictionary_id_snapshot is not null
      and source_exam_use_release_id_snapshot is not null
      and source_occurrence_id_snapshot is not null)
  );

alter table public.assignment_review_targets
  add constraint assignment_review_targets_dictionary_id_check check (
    canonical_dictionary_id_snapshot is null
    or canonical_dictionary_id_snapshot ~
      '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  );

create index student_vocab_wrong_events_student_dictionary_time_idx
  on public.student_vocab_wrong_events (
    student_id,
    canonical_dictionary_id_snapshot,
    wrong_at desc
  )
  where canonical_dictionary_id_snapshot is not null;

create index student_vocab_state_dictionary_idx
  on public.student_vocab_state (
    student_id,
    canonical_dictionary_id_snapshot
  )
  where canonical_dictionary_id_snapshot is not null;

create unique index student_vocab_review_queue_active_dictionary_unique
  on public.student_vocab_review_queue (
    student_id,
    dataset_id,
    canonical_dictionary_id_snapshot
  )
  where status = 'pending'
    and canonical_dictionary_id_snapshot is not null;

create unique index assignment_review_targets_active_dictionary_unique
  on public.assignment_review_targets (
    student_id,
    dataset_id,
    canonical_dictionary_id_snapshot
  )
  where released_at is null
    and canonical_dictionary_id_snapshot is not null;

-- A quiz question points to exactly one immutable assignment snapshot. Abort
-- rather than choosing an arbitrary dictionary identity during backfill.
do $$
begin
  if exists (
    select 1
    from public.student_vocab_wrong_events as wrong_event
    join public.quiz_questions as question
      on question.id = wrong_event.quiz_question_id
    join public.quiz_attempts as attempt
      on attempt.id = question.attempt_id
    join public.assignment_question_exam_use_snapshot as snapshot
      on snapshot.assignment_question_id = question.assignment_question_id
    where snapshot.vocab_entry_id <> wrong_event.vocab_entry_id
       or snapshot.dataset_id <> wrong_event.dataset_id
       or question.attempt_id <> wrong_event.quiz_attempt_id
       or attempt.student_id <> wrong_event.student_id
       or snapshot.assignment_id <> attempt.assignment_id
  )
  or exists (
    select 1
    from public.student_vocab_review_queue as queue
    join public.quiz_questions as question
      on question.id = queue.source_question_id
    join public.quiz_attempts as attempt
      on attempt.id = question.attempt_id
    join public.assignment_question_exam_use_snapshot as snapshot
      on snapshot.assignment_question_id = question.assignment_question_id
    where snapshot.dataset_id <> queue.dataset_id
       or question.attempt_id <> queue.source_attempt_id
       or attempt.student_id <> queue.student_id
       or snapshot.assignment_id <> attempt.assignment_id
  )
  then
    raise exception 'wrong_exam_use_snapshot_backfill_mismatch';
  end if;
end;
$$;

update public.student_vocab_wrong_events as wrong_event
set
  canonical_dictionary_id_snapshot = snapshot.dictionary_id,
  exam_use_release_id_snapshot = snapshot.release_id,
  occurrence_id_snapshot = snapshot.occurrence_id
from public.quiz_questions as question
join public.assignment_question_exam_use_snapshot as snapshot
  on snapshot.assignment_question_id = question.assignment_question_id
where question.id = wrong_event.quiz_question_id;

update public.student_vocab_review_queue as queue
set
  vocab_entry_id = snapshot.vocab_entry_id,
  canonical_lexeme_id_snapshot = coalesce(
    bank_question.canonical_lexeme_id_snapshot,
    queue.canonical_lexeme_id_snapshot
  ),
  canonical_dictionary_id_snapshot = snapshot.dictionary_id,
  source_exam_use_release_id_snapshot = snapshot.release_id,
  source_occurrence_id_snapshot = snapshot.occurrence_id
from public.quiz_questions as question
join public.assignment_questions as bank_question
  on bank_question.id = question.assignment_question_id
join public.assignment_question_exam_use_snapshot as snapshot
  on snapshot.assignment_question_id = question.assignment_question_id
where question.id = queue.source_question_id;

update public.assignment_review_targets as target
set canonical_dictionary_id_snapshot = snapshot.dictionary_id
from public.assignment_question_exam_use_snapshot as snapshot
where snapshot.assignment_question_id = target.assignment_question_id;

do $$
begin
  if exists (
    select 1
    from public.student_vocab_state as state
    join public.quiz_questions as question
      on question.attempt_id = state.last_attempt_id
     and question.vocab_entry_id = state.vocab_entry_id
    join public.assignment_question_exam_use_snapshot as snapshot
      on snapshot.assignment_question_id = question.assignment_question_id
    group by state.student_id, state.vocab_entry_id
    having count(distinct snapshot.dictionary_id) > 1
  ) then
    raise exception 'vocab_state_exam_use_snapshot_ambiguous';
  end if;
end;
$$;

update public.student_vocab_state as state
set canonical_dictionary_id_snapshot = source.dictionary_id
from (
  select
    state_row.student_id,
    state_row.vocab_entry_id,
    min(snapshot.dictionary_id) as dictionary_id
  from public.student_vocab_state as state_row
  join public.quiz_questions as question
    on question.attempt_id = state_row.last_attempt_id
   and question.vocab_entry_id = state_row.vocab_entry_id
  join public.assignment_question_exam_use_snapshot as snapshot
    on snapshot.assignment_question_id = question.assignment_question_id
  group by state_row.student_id, state_row.vocab_entry_id
) as source
where source.student_id = state.student_id
  and source.vocab_entry_id = state.vocab_entry_id;

create function private.snapshot_wrong_event_exam_use_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_row record;
begin
  select
    snapshot.*,
    question.attempt_id as question_attempt_id,
    attempt.student_id as question_student_id
  into snapshot_row
  from public.quiz_questions as question
  join public.quiz_attempts as attempt
    on attempt.id = question.attempt_id
  join public.assignment_question_exam_use_snapshot as snapshot
    on snapshot.assignment_question_id = question.assignment_question_id
  where question.id = new.quiz_question_id;

  if found then
    if snapshot_row.dataset_id <> new.dataset_id
      or snapshot_row.vocab_entry_id <> new.vocab_entry_id
      or snapshot_row.question_attempt_id <> new.quiz_attempt_id
      or snapshot_row.question_student_id <> new.student_id
      or snapshot_row.assignment_id is distinct from (
        select attempt.assignment_id
        from public.quiz_attempts as attempt
        where attempt.id = new.quiz_attempt_id
      )
      or (new.canonical_dictionary_id_snapshot is not null
        and new.canonical_dictionary_id_snapshot <>
          snapshot_row.dictionary_id)
    then
      raise exception 'wrong_event_exam_use_snapshot_mismatch'
        using errcode = '23503';
    end if;
    new.canonical_dictionary_id_snapshot := snapshot_row.dictionary_id;
    new.exam_use_release_id_snapshot := snapshot_row.release_id;
    new.occurrence_id_snapshot := snapshot_row.occurrence_id;
  end if;
  return new;
end;
$$;

create trigger student_vocab_wrong_events_snapshot_exam_use_identity
before insert or update of quiz_question_id, quiz_attempt_id, student_id,
  dataset_id, vocab_entry_id
on public.student_vocab_wrong_events
for each row
execute function private.snapshot_wrong_event_exam_use_identity_v1();

create function private.snapshot_review_queue_exam_use_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_row record;
begin
  select
    snapshot.*,
    question.attempt_id as question_attempt_id,
    attempt.student_id as question_student_id,
    bank_question.canonical_lexeme_id_snapshot
      as question_canonical_lexeme_id
  into snapshot_row
  from public.quiz_questions as question
  join public.quiz_attempts as attempt
    on attempt.id = question.attempt_id
  join public.assignment_questions as bank_question
    on bank_question.id = question.assignment_question_id
  join public.assignment_question_exam_use_snapshot as snapshot
    on snapshot.assignment_question_id = question.assignment_question_id
  where question.id = new.source_question_id;

  if found then
    if snapshot_row.dataset_id <> new.dataset_id
      or snapshot_row.question_attempt_id <> new.source_attempt_id
      or snapshot_row.question_student_id <> new.student_id
      or snapshot_row.assignment_id is distinct from (
        select attempt.assignment_id
        from public.quiz_attempts as attempt
        where attempt.id = new.source_attempt_id
      )
      or (new.canonical_dictionary_id_snapshot is not null
        and new.canonical_dictionary_id_snapshot <>
          snapshot_row.dictionary_id)
    then
      raise exception 'review_queue_exam_use_snapshot_mismatch'
        using errcode = '23503';
    end if;
    new.vocab_entry_id := snapshot_row.vocab_entry_id;
    new.canonical_lexeme_id_snapshot := coalesce(
      snapshot_row.question_canonical_lexeme_id,
      new.canonical_lexeme_id_snapshot
    );
    new.canonical_dictionary_id_snapshot := snapshot_row.dictionary_id;
    new.source_exam_use_release_id_snapshot := snapshot_row.release_id;
    new.source_occurrence_id_snapshot := snapshot_row.occurrence_id;
  end if;
  return new;
end;
$$;

create trigger student_vocab_review_queue_snapshot_exam_use_identity
before insert or update of source_question_id, source_attempt_id, student_id,
  dataset_id, vocab_entry_id
on public.student_vocab_review_queue
for each row
execute function private.snapshot_review_queue_exam_use_identity_v1();

create function private.snapshot_vocab_state_dictionary_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_dictionary_id text;
  snapshot_dictionary_count integer;
begin
  if not exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.id = new.last_attempt_id
      and attempt.student_id = new.student_id
  ) then
    raise exception 'vocab_state_attempt_owner_mismatch'
      using errcode = '23503';
  end if;

  select
    min(snapshot.dictionary_id),
    count(distinct snapshot.dictionary_id)
  into snapshot_dictionary_id, snapshot_dictionary_count
  from public.quiz_questions as question
  join public.assignment_question_exam_use_snapshot as snapshot
    on snapshot.assignment_question_id = question.assignment_question_id
  where question.attempt_id = new.last_attempt_id
    and question.vocab_entry_id = new.vocab_entry_id
    and exists (
      select 1
      from public.quiz_attempts as attempt
      where attempt.id = question.attempt_id
        and attempt.student_id = new.student_id
        and attempt.assignment_id = snapshot.assignment_id
    );

  if snapshot_dictionary_count > 1 then
    raise exception 'vocab_state_exam_use_snapshot_ambiguous'
      using errcode = '21000';
  end if;
  if snapshot_dictionary_id is not null then
    if new.canonical_dictionary_id_snapshot is not null
      and new.canonical_dictionary_id_snapshot <>
        snapshot_dictionary_id
    then
      raise exception 'vocab_state_exam_use_snapshot_mismatch'
        using errcode = '23503';
    end if;
    new.canonical_dictionary_id_snapshot := snapshot_dictionary_id;
  end if;
  return new;
end;
$$;

create trigger student_vocab_state_snapshot_dictionary_identity
before insert or update of last_attempt_id, vocab_entry_id
on public.student_vocab_state
for each row
execute function private.snapshot_vocab_state_dictionary_identity_v1();

create function private.snapshot_review_target_dictionary_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_identity record;
begin
  select
    snapshot.assignment_id,
    snapshot.dataset_id,
    snapshot.vocab_entry_id,
    snapshot.dictionary_id,
    bank_question.canonical_lexeme_id_snapshot,
    queue.student_id as queue_student_id,
    queue.dataset_id as queue_dataset_id,
    queue.canonical_dictionary_id_snapshot as queue_dictionary_id,
    queue.canonical_lexeme_id_snapshot as queue_canonical_lexeme_id
  into target_identity
  from public.assignment_question_exam_use_snapshot as snapshot
  join public.assignment_questions as bank_question
    on bank_question.id = snapshot.assignment_question_id
  join public.student_vocab_review_queue as queue
    on queue.id = new.review_queue_id
  where snapshot.assignment_question_id = new.assignment_question_id;

  if found then
    if target_identity.assignment_id <> new.assignment_id
      or target_identity.dataset_id <> new.dataset_id
      or target_identity.queue_student_id <> new.student_id
      or target_identity.queue_dataset_id <> new.dataset_id
      or not exists (
        select 1
        from public.assignment_students as link
        where link.assignment_id = new.assignment_id
          and link.student_id = new.student_id
      )
      or (
        target_identity.queue_dictionary_id is not null
        and target_identity.queue_dictionary_id <>
          target_identity.dictionary_id
      )
    then
      raise exception 'review_target_exam_use_owner_mismatch'
        using errcode = '23503';
    end if;
    if new.canonical_dictionary_id_snapshot is not null
      and new.canonical_dictionary_id_snapshot <>
        target_identity.dictionary_id
    then
      raise exception 'review_target_exam_use_snapshot_mismatch'
        using errcode = '23503';
    end if;
    new.vocab_entry_id := target_identity.vocab_entry_id;
    new.canonical_lexeme_id_snapshot := coalesce(
      target_identity.canonical_lexeme_id_snapshot,
      target_identity.queue_canonical_lexeme_id
    );
    new.canonical_dictionary_id_snapshot :=
      target_identity.dictionary_id;
  end if;
  return new;
end;
$$;

create trigger assignment_review_targets_00_snapshot_dictionary_identity
before insert or update of assignment_question_id, assignment_id,
  review_queue_id, student_id, dataset_id, vocab_entry_id,
  canonical_dictionary_id_snapshot
on public.assignment_review_targets
for each row
execute function private.snapshot_review_target_dictionary_identity_v1();

-- Compare one textbook word identity without allowing a weak fallback to
-- override two conflicting strong IDs. Missing new IDs may still bridge to
-- historical UUID/entry rows.
create function private.vocab_identity_matches_v1(
  p_left_dataset_id uuid,
  p_left_vocab_entry_id bigint,
  p_left_dictionary_id text,
  p_left_canonical_lexeme_id uuid,
  p_left_headword text,
  p_right_dataset_id uuid,
  p_right_vocab_entry_id bigint,
  p_right_dictionary_id text,
  p_right_canonical_lexeme_id uuid,
  p_right_headword text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_left_dataset_id is distinct from p_right_dataset_id then false
    when p_left_dictionary_id is not null
      and p_right_dictionary_id is not null
      then p_left_dictionary_id = p_right_dictionary_id
    when p_left_canonical_lexeme_id is not null
      and p_right_canonical_lexeme_id is not null
      then p_left_canonical_lexeme_id = p_right_canonical_lexeme_id
    when p_left_vocab_entry_id = p_right_vocab_entry_id then true
    when p_left_dictionary_id is null
      and p_right_dictionary_id is null
      and p_left_canonical_lexeme_id is null
      and p_right_canonical_lexeme_id is null
      and nullif(lower(trim(replace(p_left_headword, '*', ''))), '')
        is not null
      then lower(trim(replace(p_left_headword, '*', ''))) =
        lower(trim(replace(p_right_headword, '*', '')))
    else false
  end;
$$;

create or replace function private.record_wrong_events_for_attempt(
  p_attempt_id uuid,
  p_student_id uuid,
  p_completed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if not exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.id = p_attempt_id
      and attempt.student_id = p_student_id
  ) then
    raise exception 'wrong_event_attempt_owner_mismatch'
      using errcode = '23503';
  end if;

  insert into public.student_vocab_wrong_events (
    student_id,
    dataset_id,
    vocab_entry_id,
    canonical_dictionary_id_snapshot,
    canonical_lexeme_id_snapshot,
    exam_use_release_id_snapshot,
    occurrence_id_snapshot,
    quiz_attempt_id,
    quiz_question_id,
    wrong_stage,
    wrong_at
  )
  select
    p_student_id,
    entry.dataset_id,
    question.vocab_entry_id,
    exam_snapshot.dictionary_id,
    bank_question.canonical_lexeme_id_snapshot,
    exam_snapshot.release_id,
    exam_snapshot.occurrence_id,
    p_attempt_id,
    question.id,
    stage.wrong_stage,
    coalesce(stage.wrong_at, p_completed_at)
  from public.quiz_attempts as attempt
  join public.quiz_questions as question
    on question.attempt_id = attempt.id
  join public.vocab_entries as entry
    on entry.id = question.vocab_entry_id
  left join public.assignment_questions as bank_question
    on bank_question.id = question.assignment_question_id
   and bank_question.assignment_id = attempt.assignment_id
  left join public.assignment_question_exam_use_snapshot as exam_snapshot
    on exam_snapshot.assignment_question_id = question.assignment_question_id
   and exam_snapshot.assignment_id = attempt.assignment_id
   and exam_snapshot.dataset_id = entry.dataset_id
   and exam_snapshot.vocab_entry_id = question.vocab_entry_id
  cross join lateral (
    values
      (
        'initial'::text,
        question.initial_is_correct,
        question.initial_answered_at
      ),
      (
        'retry'::text,
        question.retry_is_correct,
        question.retry_answered_at
      )
  ) as stage(wrong_stage, is_correct, wrong_at)
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
    and stage.is_correct is false
  on conflict (quiz_question_id, wrong_stage) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function private.snapshot_prior_wrong_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_identity record;
begin
  select
    attempt.student_id,
    attempt.started_at,
    entry.dataset_id,
    entry.id as vocab_entry_id,
    exam_snapshot.dictionary_id,
    bank_question.canonical_lexeme_id_snapshot,
    coalesce(
      bank_question.headword_normalized_snapshot,
      entry.headword_normalized
    ) as headword_normalized
  into target_identity
  from public.quiz_attempts as attempt
  join public.vocab_entries as entry
    on entry.id = new.vocab_entry_id
  left join public.assignment_questions as bank_question
    on bank_question.id = new.assignment_question_id
   and bank_question.assignment_id = attempt.assignment_id
  left join public.assignment_question_exam_use_snapshot as exam_snapshot
    on exam_snapshot.assignment_question_id = new.assignment_question_id
   and exam_snapshot.assignment_id = attempt.assignment_id
   and exam_snapshot.dataset_id = entry.dataset_id
   and exam_snapshot.vocab_entry_id = entry.id
  where attempt.id = new.attempt_id;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  select count(distinct wrong_event.quiz_attempt_id)::integer
  into new.prior_wrong_count
  from public.student_vocab_wrong_events as wrong_event
  join public.quiz_attempts as source_attempt
    on source_attempt.id = wrong_event.quiz_attempt_id
  join public.vocab_entries as source_entry
    on source_entry.id = wrong_event.vocab_entry_id
   and source_entry.dataset_id = wrong_event.dataset_id
  where wrong_event.student_id = target_identity.student_id
    and wrong_event.wrong_stage = 'initial'
    and source_attempt.status in ('completed', 'expired')
    and source_attempt.completed_at < target_identity.started_at
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id_snapshot,
      target_identity.headword_normalized,
      wrong_event.dataset_id,
      wrong_event.vocab_entry_id,
      wrong_event.canonical_dictionary_id_snapshot,
      wrong_event.canonical_lexeme_id_snapshot,
      source_entry.headword_normalized
    );

  return new;
end;
$$;

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
    canonical_dictionary_id_snapshot,
    unresolved_wrong_count,
    last_wrong_at,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  select
    new.student_id,
    question.vocab_entry_id,
    exam_snapshot.dictionary_id,
    1,
    coalesce(question.initial_answered_at, evaluation_time),
    null,
    new.id,
    evaluation_time
  from public.quiz_questions as question
  left join public.assignment_question_exam_use_snapshot as exam_snapshot
    on exam_snapshot.assignment_question_id = question.assignment_question_id
   and exam_snapshot.assignment_id = new.assignment_id
   and exam_snapshot.vocab_entry_id = question.vocab_entry_id
  where question.attempt_id = new.id
    and question.initial_is_correct is false
  on conflict (student_id, vocab_entry_id)
  do update set
    canonical_dictionary_id_snapshot = coalesce(
      excluded.canonical_dictionary_id_snapshot,
      public.student_vocab_state.canonical_dictionary_id_snapshot
    ),
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
        join public.vocab_entries as wrong_entry
          on wrong_entry.id = wrong_event.vocab_entry_id
         and wrong_entry.dataset_id = wrong_event.dataset_id
        where wrong_event.student_id = new.student_id
          and wrong_event.wrong_stage = 'initial'
          and private.vocab_identity_matches_v1(
            queue.dataset_id,
            queue.vocab_entry_id,
            queue.canonical_dictionary_id_snapshot,
            queue.canonical_lexeme_id_snapshot,
            queue_entry.headword_normalized,
            wrong_event.dataset_id,
            wrong_event.vocab_entry_id,
            wrong_event.canonical_dictionary_id_snapshot,
            wrong_event.canonical_lexeme_id_snapshot,
            wrong_entry.headword_normalized
          )
      )
    )
  )::smallint
  from public.vocab_entries as queue_entry
  where queue_entry.id = queue.vocab_entry_id
    and queue_entry.dataset_id = queue.dataset_id
    and queue.student_id = new.student_id
    and queue.status = 'pending';

  return new;
end;
$$;

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
    and student.deleted_at is null
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
    and state.resolved_at is null
    and exists (
      select 1
      from public.student_vocab_wrong_events as wrong_event
      where wrong_event.quiz_question_id = question.id
        and wrong_event.quiz_attempt_id = attempt.id
        and wrong_event.student_id = p_student_id
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
      wrong_event.canonical_dictionary_id_snapshot,
      wrong_event.canonical_lexeme_id_snapshot,
      wrong_event.exam_use_release_id_snapshot,
      wrong_event.occurrence_id_snapshot,
      least(
        2,
        count(distinct history.quiz_attempt_id) filter (
          where history.wrong_stage = 'initial'
        )
      )::smallint as reason_level
    from public.quiz_questions as question
    join public.quiz_attempts as attempt
      on attempt.id = question.attempt_id
     and attempt.student_id = p_student_id
    join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
    join public.student_vocab_wrong_events as wrong_event
      on wrong_event.quiz_question_id = question.id
     and wrong_event.quiz_attempt_id = question.attempt_id
     and wrong_event.student_id = p_student_id
     and wrong_event.wrong_stage = 'initial'
    join public.student_vocab_wrong_events as history
      on history.student_id = p_student_id
     and history.wrong_stage = 'initial'
    join public.vocab_entries as history_entry
      on history_entry.id = history.vocab_entry_id
     and history_entry.dataset_id = history.dataset_id
     and private.vocab_identity_matches_v1(
       entry.dataset_id,
       question.vocab_entry_id,
       wrong_event.canonical_dictionary_id_snapshot,
       wrong_event.canonical_lexeme_id_snapshot,
       entry.headword_normalized,
       history.dataset_id,
       history.vocab_entry_id,
       history.canonical_dictionary_id_snapshot,
       history.canonical_lexeme_id_snapshot,
       history_entry.headword_normalized
     )
    where question.id = any(p_question_ids)
    group by
      question.id,
      question.attempt_id,
      question.vocab_entry_id,
      entry.dataset_id,
      entry.headword_normalized,
      wrong_event.canonical_dictionary_id_snapshot,
      wrong_event.canonical_lexeme_id_snapshot,
      wrong_event.exam_use_release_id_snapshot,
      wrong_event.occurrence_id_snapshot
    order by question.id
  loop
    existing_queue_id := null;
    select queue.id
    into existing_queue_id
    from public.student_vocab_review_queue as queue
    join public.vocab_entries as queue_entry
      on queue_entry.id = queue.vocab_entry_id
     and queue_entry.dataset_id = queue.dataset_id
    where queue.student_id = p_student_id
      and queue.dataset_id = selected.dataset_id
      and queue.status = 'pending'
      and private.vocab_identity_matches_v1(
        queue.dataset_id,
        queue.vocab_entry_id,
        queue.canonical_dictionary_id_snapshot,
        queue.canonical_lexeme_id_snapshot,
        queue_entry.headword_normalized,
        selected.dataset_id,
        selected.vocab_entry_id,
        selected.canonical_dictionary_id_snapshot,
        selected.canonical_lexeme_id_snapshot,
        selected.headword_normalized
      )
    order by queue.queued_at desc, queue.id
    limit 1
    for update of queue;

    if existing_queue_id is null then
      insert into public.student_vocab_review_queue (
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_dictionary_id_snapshot,
        canonical_lexeme_id_snapshot,
        source_exam_use_release_id_snapshot,
        source_occurrence_id_snapshot,
        source_attempt_id,
        source_question_id,
        reason_level,
        queued_by
      )
      values (
        p_student_id,
        selected.dataset_id,
        selected.vocab_entry_id,
        selected.canonical_dictionary_id_snapshot,
        selected.canonical_lexeme_id_snapshot,
        selected.exam_use_release_id_snapshot,
        selected.occurrence_id_snapshot,
        selected.attempt_id,
        selected.question_id,
        greatest(selected.reason_level, 1),
        (select auth.uid())
      )
      returning id into existing_queue_id;
    else
      update public.student_vocab_review_queue as queue
      set
        vocab_entry_id = selected.vocab_entry_id,
        canonical_dictionary_id_snapshot =
          selected.canonical_dictionary_id_snapshot,
        canonical_lexeme_id_snapshot =
          selected.canonical_lexeme_id_snapshot,
        source_exam_use_release_id_snapshot =
          selected.exam_use_release_id_snapshot,
        source_occurrence_id_snapshot = selected.occurrence_id_snapshot,
        source_attempt_id = selected.attempt_id,
        source_question_id = selected.question_id,
        reason_level = greatest(
          queue.reason_level,
          selected.reason_level,
          1
        )
      where queue.id = existing_queue_id;
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
    'student.review_queue.words_queued_dictionary_v1',
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

-- Resolve every occurrence that belongs to the same dictionary word. A newer
-- wrong-state evaluation still wins over a late correct-answer write.
create or replace function private.resolve_vocab_state_on_correct_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_identity record;
  identity_is_resolved boolean;
  evaluated_at timestamptz := coalesce(
    new.retry_answered_at,
    new.initial_answered_at,
    clock_timestamp()
  );
begin
  select
    attempt.student_id,
    entry.dataset_id,
    entry.id as vocab_entry_id,
    exam_snapshot.dictionary_id,
    coalesce(
      bank_question.canonical_lexeme_id_snapshot,
      current_identity.canonical_lexeme_id
    ) as canonical_lexeme_id,
    coalesce(
      bank_question.headword_normalized_snapshot,
      entry.headword_normalized
    ) as headword_normalized
  into target_identity
  from public.quiz_attempts as attempt
  join public.vocab_entries as entry
    on entry.id = new.vocab_entry_id
  left join public.assignment_questions as bank_question
    on bank_question.id = new.assignment_question_id
   and bank_question.assignment_id = attempt.assignment_id
  left join public.assignment_question_exam_use_snapshot as exam_snapshot
    on exam_snapshot.assignment_question_id = new.assignment_question_id
   and exam_snapshot.assignment_id = attempt.assignment_id
   and exam_snapshot.dataset_id = entry.dataset_id
   and exam_snapshot.vocab_entry_id = entry.id
  left join lateral (
    select min(eligibility.canonical_lexeme_id::text)::uuid
      as canonical_lexeme_id
    from public.vocab_entry_quiz_eligibility as eligibility
    where eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
  ) as current_identity on true
  where attempt.id = new.attempt_id;

  if not found then
    raise exception 'correct_answer_identity_not_found'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.students as student
  where student.id = target_identity.student_id
  for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    canonical_dictionary_id_snapshot,
    unresolved_wrong_count,
    last_wrong_at,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  values (
    target_identity.student_id,
    target_identity.vocab_entry_id,
    target_identity.dictionary_id,
    0,
    null,
    evaluated_at,
    new.attempt_id,
    evaluated_at
  )
  on conflict (student_id, vocab_entry_id)
  do update set
    canonical_dictionary_id_snapshot = coalesce(
      excluded.canonical_dictionary_id_snapshot,
      public.student_vocab_state.canonical_dictionary_id_snapshot
    ),
    unresolved_wrong_count = 0,
    resolved_at = excluded.resolved_at,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at >=
    public.student_vocab_state.last_evaluated_at;

  update public.student_vocab_state as state
  set
    unresolved_wrong_count = 0,
    resolved_at = evaluated_at,
    last_attempt_id = new.attempt_id,
    last_evaluated_at = evaluated_at
  from public.vocab_entries as state_entry
  left join lateral (
    select min(eligibility.canonical_lexeme_id::text)::uuid
      as canonical_lexeme_id
    from public.vocab_entry_quiz_eligibility as eligibility
    where eligibility.vocab_entry_id = state_entry.id
      and eligibility.dataset_id = state_entry.dataset_id
      and eligibility.status = 'eligible'
  ) as state_identity on true
  where state.student_id = target_identity.student_id
    and state_entry.id = state.vocab_entry_id
    and state_entry.dataset_id = target_identity.dataset_id
    and evaluated_at >= state.last_evaluated_at
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id,
      target_identity.headword_normalized,
      state_entry.dataset_id,
      state.vocab_entry_id,
      state.canonical_dictionary_id_snapshot,
      state_identity.canonical_lexeme_id,
      state_entry.headword_normalized
    );

  select not exists (
    select 1
    from public.student_vocab_state as state
    join public.vocab_entries as state_entry
      on state_entry.id = state.vocab_entry_id
     and state_entry.dataset_id = target_identity.dataset_id
    left join lateral (
      select min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = state_entry.id
        and eligibility.dataset_id = state_entry.dataset_id
        and eligibility.status = 'eligible'
    ) as state_identity on true
    where state.student_id = target_identity.student_id
      and state.unresolved_wrong_count > 0
      and state.resolved_at is null
      and private.vocab_identity_matches_v1(
        target_identity.dataset_id,
        target_identity.vocab_entry_id,
        target_identity.dictionary_id,
        target_identity.canonical_lexeme_id,
        target_identity.headword_normalized,
        state_entry.dataset_id,
        state.vocab_entry_id,
        state.canonical_dictionary_id_snapshot,
        state_identity.canonical_lexeme_id,
        state_entry.headword_normalized
      )
  ) into identity_is_resolved;

  update public.student_vocab_review_queue as queue
  set
    status = 'cancelled',
    cancelled_at = evaluated_at,
    consumed_assignment_id = null,
    consumed_at = null,
    reserved_review_draft_id = null,
    reserved_at = null
  from public.vocab_entries as queue_entry
  where queue.student_id = target_identity.student_id
    and queue.dataset_id = target_identity.dataset_id
    and queue_entry.id = queue.vocab_entry_id
    and queue_entry.dataset_id = queue.dataset_id
    and queue.status in ('pending', 'consumed')
    and identity_is_resolved
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id,
      target_identity.headword_normalized,
      queue.dataset_id,
      queue.vocab_entry_id,
      queue.canonical_dictionary_id_snapshot,
      queue.canonical_lexeme_id_snapshot,
      queue_entry.headword_normalized
    );

  update public.assignment_review_targets as target
  set
    released_at = evaluated_at,
    release_reason = 'resolved'
  from public.vocab_entries as target_entry
  where target.student_id = target_identity.student_id
    and target.dataset_id = target_identity.dataset_id
    and target_entry.id = target.vocab_entry_id
    and target_entry.dataset_id = target.dataset_id
    and target.released_at is null
    and identity_is_resolved
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id,
      target_identity.headword_normalized,
      target.dataset_id,
      target.vocab_entry_id,
      target.canonical_dictionary_id_snapshot,
      target.canonical_lexeme_id_snapshot,
      target_entry.headword_normalized
    );

  return new;
end;
$$;

create or replace function private.reopen_selected_vocab_review_queue_v1(
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
  target_identity record;
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

  perform 1
  from public.students as student
  where student.id = p_student_id
  for update;
  if not found then
    return null;
  end if;

  select
    entry.dataset_id,
    entry.id as vocab_entry_id,
    coalesce(
      exact_state.canonical_dictionary_id_snapshot,
      latest_target.canonical_dictionary_id_snapshot,
      latest_wrong.canonical_dictionary_id_snapshot
    ) as dictionary_id,
    coalesce(
      latest_target.canonical_lexeme_id_snapshot,
      latest_wrong.canonical_lexeme_id_snapshot,
      current_identity.canonical_lexeme_id
    ) as canonical_lexeme_id,
    entry.headword_normalized
  into target_identity
  from public.vocab_entries as entry
  left join public.student_vocab_state as exact_state
    on exact_state.student_id = p_student_id
   and exact_state.vocab_entry_id = entry.id
  left join lateral (
    select
      target.canonical_dictionary_id_snapshot,
      target.canonical_lexeme_id_snapshot
    from public.assignment_review_targets as target
    where target.student_id = p_student_id
      and target.dataset_id = entry.dataset_id
      and target.vocab_entry_id = entry.id
    order by target.assigned_at desc, target.id
    limit 1
  ) as latest_target on true
  left join lateral (
    select
      wrong_event.canonical_dictionary_id_snapshot,
      wrong_event.canonical_lexeme_id_snapshot
    from public.student_vocab_wrong_events as wrong_event
    where wrong_event.student_id = p_student_id
      and wrong_event.dataset_id = entry.dataset_id
      and wrong_event.vocab_entry_id = entry.id
    order by wrong_event.wrong_at desc, wrong_event.id desc
    limit 1
  ) as latest_wrong on true
  left join lateral (
    select min(eligibility.canonical_lexeme_id::text)::uuid
      as canonical_lexeme_id
    from public.vocab_entry_quiz_eligibility as eligibility
    where eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
  ) as current_identity on true
  where entry.id = p_vocab_entry_id;

  if not found
    or not exists (
      select 1
      from public.student_vocab_state as state
      join public.vocab_entries as state_entry
        on state_entry.id = state.vocab_entry_id
       and state_entry.dataset_id = target_identity.dataset_id
      left join lateral (
        select min(eligibility.canonical_lexeme_id::text)::uuid
          as canonical_lexeme_id
        from public.vocab_entry_quiz_eligibility as eligibility
        where eligibility.vocab_entry_id = state_entry.id
          and eligibility.dataset_id = state_entry.dataset_id
          and eligibility.status = 'eligible'
      ) as state_identity on true
      where state.student_id = p_student_id
        and state.unresolved_wrong_count > 0
        and state.resolved_at is null
        and private.vocab_identity_matches_v1(
          target_identity.dataset_id,
          target_identity.vocab_entry_id,
          target_identity.dictionary_id,
          target_identity.canonical_lexeme_id,
          target_identity.headword_normalized,
          state_entry.dataset_id,
          state.vocab_entry_id,
          state.canonical_dictionary_id_snapshot,
          state_identity.canonical_lexeme_id,
          state_entry.headword_normalized
        )
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
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id,
      target_identity.headword_normalized,
      wrong_event.dataset_id,
      wrong_event.vocab_entry_id,
      wrong_event.canonical_dictionary_id_snapshot,
      wrong_event.canonical_lexeme_id_snapshot,
      wrong_entry.headword_normalized
    );

  select queue.id
  into pending_queue_id
  from public.student_vocab_review_queue as queue
  join public.vocab_entries as queue_entry
    on queue_entry.id = queue.vocab_entry_id
   and queue_entry.dataset_id = queue.dataset_id
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id,
      target_identity.headword_normalized,
      queue.dataset_id,
      queue.vocab_entry_id,
      queue.canonical_dictionary_id_snapshot,
      queue.canonical_lexeme_id_snapshot,
      queue_entry.headword_normalized
    )
  order by queue.updated_at desc, queue.queued_at desc, queue.id
  limit 1
  for update of queue;

  if pending_queue_id is not null then
    update public.student_vocab_review_queue
    set reason_level = greatest(reason_level, target_reason_level)
    where id = pending_queue_id;
    return pending_queue_id;
  end if;

  if exists (
    select 1
    from public.assignment_review_targets as target
    join public.vocab_entries as target_entry
      on target_entry.id = target.vocab_entry_id
     and target_entry.dataset_id = target.dataset_id
    where target.student_id = p_student_id
      and target.released_at is null
      and private.vocab_identity_matches_v1(
        target_identity.dataset_id,
        target_identity.vocab_entry_id,
        target_identity.dictionary_id,
        target_identity.canonical_lexeme_id,
        target_identity.headword_normalized,
        target.dataset_id,
        target.vocab_entry_id,
        target.canonical_dictionary_id_snapshot,
        target.canonical_lexeme_id_snapshot,
        target_entry.headword_normalized
      )
  ) then
    return null;
  end if;

  select queue.id
  into historical_queue_id
  from public.student_vocab_review_queue as queue
  join public.vocab_entries as queue_entry
    on queue_entry.id = queue.vocab_entry_id
   and queue_entry.dataset_id = queue.dataset_id
  where queue.student_id = p_student_id
    and queue.status in ('consumed', 'cancelled')
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id,
      target_identity.headword_normalized,
      queue.dataset_id,
      queue.vocab_entry_id,
      queue.canonical_dictionary_id_snapshot,
      queue.canonical_lexeme_id_snapshot,
      queue_entry.headword_normalized
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
    reason_level = greatest(reason_level, target_reason_level),
    consumed_assignment_id = null,
    consumed_at = null,
    cancelled_at = null,
    reserved_review_draft_id = null,
    reserved_at = null
  where id = historical_queue_id;

  return historical_queue_id;
end;
$$;

create or replace function
  private.reopen_selected_vocab_review_queue_after_missed_target()
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

  select max(state.unresolved_wrong_count)
  into current_wrong_count
  from public.student_vocab_state as state
  join public.vocab_entries as state_entry
    on state_entry.id = state.vocab_entry_id
  join public.vocab_entries as target_entry
    on target_entry.id = new.vocab_entry_id
   and target_entry.dataset_id = new.dataset_id
  left join lateral (
    select min(eligibility.canonical_lexeme_id::text)::uuid
      as canonical_lexeme_id
    from public.vocab_entry_quiz_eligibility as eligibility
    where eligibility.vocab_entry_id = state_entry.id
      and eligibility.dataset_id = state_entry.dataset_id
      and eligibility.status = 'eligible'
  ) as state_identity on true
  where state.student_id = new.student_id
    and state.unresolved_wrong_count > 0
    and state.resolved_at is null
    and private.vocab_identity_matches_v1(
      new.dataset_id,
      new.vocab_entry_id,
      new.canonical_dictionary_id_snapshot,
      new.canonical_lexeme_id_snapshot,
      target_entry.headword_normalized,
      state_entry.dataset_id,
      state.vocab_entry_id,
      state.canonical_dictionary_id_snapshot,
      state_identity.canonical_lexeme_id,
      state_entry.headword_normalized
    );

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

-- Match terminal questions to their immutable assignment-question target,
-- rather than assuming a historical queue entry ID is still the current one.
create or replace function private.release_review_targets_on_attempt_terminal()
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
     and question.assignment_question_id = target.assignment_question_id
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
          and question.assignment_question_id =
            target.assignment_question_id
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
  unresolved_rows as materialized (
    select
      student.id as student_id,
      student.dataset_id,
      state.vocab_entry_id,
      state.canonical_dictionary_id_snapshot as dictionary_id,
      entry_identity.canonical_lexeme_id,
      entry.headword_normalized,
      case
        when state.canonical_dictionary_id_snapshot is not null
          then 'dictionary:' || state.canonical_dictionary_id_snapshot
        when entry_identity.canonical_lexeme_id is not null
          then 'canonical:' || entry_identity.canonical_lexeme_id::text
        else 'headword:' || lower(trim(replace(
          entry.headword_normalized,
          '*',
          ''
        )))
      end as word_key
    from page_students as student
    join public.student_vocab_state as state
      on state.student_id = student.id
     and state.unresolved_wrong_count > 0
     and state.resolved_at is null
    join public.vocab_entries as entry
      on entry.id = state.vocab_entry_id
     and entry.dataset_id = student.dataset_id
    left join lateral (
      select min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = entry.id
        and eligibility.dataset_id = entry.dataset_id
        and eligibility.status = 'eligible'
    ) as entry_identity on true
  ),
  unresolved_words as materialized (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key,
      min(unresolved.vocab_entry_id) as vocab_entry_id,
      min(unresolved.dictionary_id) as dictionary_id,
      min(unresolved.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id,
      min(unresolved.headword_normalized) as headword_normalized
    from unresolved_rows as unresolved
    group by
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key
  ),
  word_counts as (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key,
      (
        select count(distinct wrong_event.quiz_attempt_id)
        from public.student_vocab_wrong_events as wrong_event
        join public.vocab_entries as wrong_entry
          on wrong_entry.id = wrong_event.vocab_entry_id
         and wrong_entry.dataset_id = wrong_event.dataset_id
        where wrong_event.student_id = unresolved.student_id
          and wrong_event.wrong_stage = 'initial'
          and private.vocab_identity_matches_v1(
            unresolved.dataset_id,
            unresolved.vocab_entry_id,
            unresolved.dictionary_id,
            unresolved.canonical_lexeme_id,
            unresolved.headword_normalized,
            wrong_event.dataset_id,
            wrong_event.vocab_entry_id,
            wrong_event.canonical_dictionary_id_snapshot,
            wrong_event.canonical_lexeme_id_snapshot,
            wrong_entry.headword_normalized
          )
      )::integer as wrong_count
    from unresolved_words as unresolved
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

create or replace function private.reject_duplicate_active_review_target()
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
    join public.vocab_entries as target_entry
      on target_entry.id = target.vocab_entry_id
     and target_entry.dataset_id = target.dataset_id
    join public.vocab_entries as new_entry
      on new_entry.id = new.vocab_entry_id
     and new_entry.dataset_id = new.dataset_id
    where target.student_id = new.student_id
      and target.dataset_id = new.dataset_id
      and target.released_at is null
      and private.vocab_identity_matches_v1(
        target.dataset_id,
        target.vocab_entry_id,
        target.canonical_dictionary_id_snapshot,
        target.canonical_lexeme_id_snapshot,
        target_entry.headword_normalized,
        new.dataset_id,
        new.vocab_entry_id,
        new.canonical_dictionary_id_snapshot,
        new.canonical_lexeme_id_snapshot,
        new_entry.headword_normalized
      )
  ) then
    raise exception 'review_word_already_assigned'
      using errcode = '40001';
  end if;

  return new;
end;
$$;

create or replace function private.reject_active_review_queue_consumption()
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
      join public.vocab_entries as target_entry
        on target_entry.id = target.vocab_entry_id
       and target_entry.dataset_id = target.dataset_id
      join public.vocab_entries as queue_entry
        on queue_entry.id = old.vocab_entry_id
       and queue_entry.dataset_id = old.dataset_id
      where target.student_id = old.student_id
        and target.dataset_id = old.dataset_id
        and target.released_at is null
        and private.vocab_identity_matches_v1(
          target.dataset_id,
          target.vocab_entry_id,
          target.canonical_dictionary_id_snapshot,
          target.canonical_lexeme_id_snapshot,
          target_entry.headword_normalized,
          old.dataset_id,
          old.vocab_entry_id,
          old.canonical_dictionary_id_snapshot,
          old.canonical_lexeme_id_snapshot,
          queue_entry.headword_normalized
        )
    )
  then
    raise exception 'review_word_already_assigned'
      using errcode = '40001';
  end if;

  return new;
end;
$$;

-- Version 2 compares active target words using the exam-use dictionary first,
-- then the legacy UUID, entry and normalized-headword fallbacks.
create function private.assert_assignment_words_available_v2(
  p_student_ids uuid[],
  p_dataset_id uuid,
  p_questions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_release_id uuid;
begin
  if p_student_ids is null
    or cardinality(p_student_ids) < 1
    or cardinality(p_student_ids) <> (
      select count(distinct student_id)
      from unnest(p_student_ids) as input(student_id)
      where student_id is not null
    )
    or p_dataset_id is null
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
  then
    raise exception 'invalid_assignment_word_check'
      using errcode = '22023';
  end if;

  select release.release_id
  into active_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
  limit 1;

  if active_release_id is null
    and exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    )
  then
    raise exception 'exam_use_release_inactive' using errcode = '55000';
  end if;

  if exists (
    with identity_by_entry as materialized (
      select
        entry.id as vocab_entry_id,
        occurrence.dictionary_id,
        min(eligibility.canonical_lexeme_id::text)::uuid
          as canonical_lexeme_id,
        lower(trim(replace(entry.headword_normalized, '*', '')))
          as headword_key
      from public.vocab_entries as entry
      left join public.vocab_entry_quiz_eligibility as eligibility
        on eligibility.vocab_entry_id = entry.id
       and eligibility.dataset_id = entry.dataset_id
       and eligibility.status = 'eligible'
      left join word_index.app_exam_use_occurrence as occurrence
        on occurrence.release_id = active_release_id
       and occurrence.dataset_id = entry.dataset_id
       and occurrence.vocab_entry_id = entry.id
       and occurrence.include_in_exam
       and occurrence.exam_use_status = 'reviewed_for_preview'
      where entry.dataset_id = p_dataset_id
      group by entry.id, entry.headword_normalized, occurrence.dictionary_id
    ),
    incoming_words as materialized (
      select distinct
        plan.vocab_entry_id,
        identity.dictionary_id,
        identity.canonical_lexeme_id,
        identity.headword_key
      from jsonb_to_recordset(p_questions) as plan(vocab_entry_id bigint)
      left join identity_by_entry as identity
        on identity.vocab_entry_id = plan.vocab_entry_id
    ),
    active_words as materialized (
      select
        link.student_id,
        question.vocab_entry_id,
        coalesce(
          exam_snapshot.dictionary_id,
          identity.dictionary_id
        ) as dictionary_id,
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
      left join public.assignment_question_exam_use_snapshot
        as exam_snapshot
        on exam_snapshot.assignment_question_id = question.id
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
      on private.vocab_identity_matches_v1(
        p_dataset_id,
        incoming.vocab_entry_id,
        incoming.dictionary_id,
        incoming.canonical_lexeme_id,
        incoming.headword_key,
        p_dataset_id,
        active.vocab_entry_id,
        active.dictionary_id,
        active.canonical_lexeme_id,
        active.headword_key
      )
  ) then
    raise exception 'assignment_word_already_active'
      using errcode = '40001';
  end if;
end;
$$;

-- Enrich the legacy automatic link and add dictionary-only matches that the
-- UUID-era helper cannot see. Exact callers can constrain the queue IDs.
create function private.link_pending_review_targets_v2(
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_selected_queue_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_count integer;
begin
  update public.assignment_review_targets as target
  set canonical_dictionary_id_snapshot = snapshot.dictionary_id
  from public.assignment_question_exam_use_snapshot as snapshot
  where target.assignment_id = p_assignment_id
    and target.student_id = any(p_student_ids)
    and snapshot.assignment_question_id = target.assignment_question_id
    and target.canonical_dictionary_id_snapshot is distinct from
      snapshot.dictionary_id;

  insert into public.assignment_review_targets (
    assignment_id,
    student_id,
    review_queue_id,
    assignment_question_id,
    dataset_id,
    vocab_entry_id,
    canonical_lexeme_id_snapshot,
    canonical_dictionary_id_snapshot
  )
  select
    p_assignment_id,
    link.student_id,
    selected_queue.id,
    question.id,
    question.dataset_id,
    question.vocab_entry_id,
    coalesce(
      question.canonical_lexeme_id_snapshot,
      selected_queue.canonical_lexeme_id_snapshot
    ),
    coalesce(
      exam_snapshot.dictionary_id,
      selected_queue.canonical_dictionary_id_snapshot
    )
  from public.assignment_students as link
  join public.assignment_questions as question
    on question.assignment_id = link.assignment_id
  join public.vocab_entries as question_entry
    on question_entry.id = question.vocab_entry_id
   and question_entry.dataset_id = question.dataset_id
  left join public.assignment_question_exam_use_snapshot as exam_snapshot
    on exam_snapshot.assignment_question_id = question.id
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
        p_selected_queue_ids is null
        or queue.id = any(p_selected_queue_ids)
      )
      and private.vocab_identity_matches_v1(
        queue.dataset_id,
        queue.vocab_entry_id,
        queue.canonical_dictionary_id_snapshot,
        queue.canonical_lexeme_id_snapshot,
        queue_entry.headword_normalized,
        question.dataset_id,
        question.vocab_entry_id,
        exam_snapshot.dictionary_id,
        question.canonical_lexeme_id_snapshot,
        coalesce(
          question.headword_normalized_snapshot,
          question_entry.headword_normalized
        )
      )
      and not exists (
        select 1
        from public.assignment_review_targets as existing
        where existing.assignment_id = p_assignment_id
          and existing.student_id = link.student_id
          and existing.released_at is null
          and existing.review_queue_id = queue.id
      )
    order by
      case
        when p_selected_queue_ids is not null
          then array_position(p_selected_queue_ids, queue.id)
        else null
      end,
      queue.reason_level desc,
      queue.queued_at,
      queue.id
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
          or existing.review_queue_id = selected_queue.id
        )
    )
  order by link.student_id, question.base_order_index;

  select count(*)
  into linked_count
  from public.assignment_review_targets as target
  where target.assignment_id = p_assignment_id
    and target.student_id = any(p_student_ids)
    and target.released_at is null
    and (
      p_selected_queue_ids is null
      or target.review_queue_id = any(p_selected_queue_ids)
    );

  return linked_count;
end;
$$;

-- Same signature as the proven v3 bank creator, but dispatches active
-- exam-use datasets through the immutable dictionary/occurrence snapshot path.
create function private.create_assignment_with_question_bank_exam_use_dispatch_v1(
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
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_release_id uuid;
begin
  select release.release_id
  into active_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
  for share;

  if active_release_id is null then
    if exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    ) then
      raise exception 'exam_use_release_inactive' using errcode = '55000';
    end if;

    return private.create_assignment_with_question_bank_v3(
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
  end if;

  return private.create_assignment_with_exam_use_question_bank_v1(
    active_release_id,
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
end;
$$;

-- Clone the mature queue/draft validation contract. Only the question-bank
-- dispatcher changes, and exact callers may now pass an unreserved queue
-- snapshot without creating a durable draft.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'::regprocedure
  )
  into function_definition;

  if position(
    'private.create_assignment_with_question_bank_v3('
    in function_definition
  ) = 0
    or position(
      'p_review_draft_id is null'
      in function_definition
    ) = 0
  then
    raise exception 'persist_review_assignment_v5_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.persist_review_assignment_v5(',
    'private.persist_review_assignment_exam_use_v6_compat('
  );
  function_definition := replace(
    function_definition,
    'private.create_assignment_with_question_bank_v3(',
    'private.create_assignment_with_question_bank_exam_use_dispatch_v1('
  );
  function_definition := replace(
    function_definition,
    E'p_review_draft_id is null\n      or total_question_count <> review_question_count',
    'total_question_count <> review_question_count'
  );

  if position(
    'private.persist_review_assignment_exam_use_v6_compat('
    in function_definition
  ) = 0
    or position(
      'private.create_assignment_with_question_bank_exam_use_dispatch_v1('
      in function_definition
    ) = 0
    or position(
      E'p_review_draft_id is null\n      or total_question_count <> review_question_count'
      in function_definition
    ) > 0
  then
    raise exception 'persist_review_assignment_v6_rewrite_failed';
  end if;

  execute function_definition;
end;
$$;

create function private.create_assignment_with_delivery_v6(
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
    and student.deleted_at is null
  order by student.id
  for update;

  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(p_student_ids)
    and student.status = 'active'
    and student.deleted_at is null;
  if locked_student_count <> cardinality(p_student_ids) then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  perform private.assert_assignment_words_available_v2(
    p_student_ids,
    p_dataset_id,
    p_questions
  );

  created_assignment_id :=
    private.create_assignment_with_question_bank_exam_use_dispatch_v1(
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

  perform private.link_pending_review_targets_v2(
    created_assignment_id,
    p_student_ids,
    null
  );

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.regular_v6_created',
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

create function public.create_assignment_with_delivery_v6(
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
  select private.create_assignment_with_delivery_v6(
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

-- Clone the reviewed v7 selection contract, but persist through v6 so the
-- target linker never falls back to a conflicting UUID before dictionary IDs
-- are considered.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.create_mixed_review_assignment_v7(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)'::regprocedure
  )
  into function_definition;

  if position(
    'private.create_assignment_with_delivery_v5('
    in function_definition
  ) = 0 then
    raise exception 'mixed_review_assignment_v7_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_mixed_review_assignment_v7(',
    'private.create_mixed_review_assignment_v8('
  );
  function_definition := replace(
    function_definition,
    'private.create_assignment_with_delivery_v5(',
    'private.create_assignment_with_delivery_v6('
  );
  function_definition := replace(
    function_definition,
    'assignment.mixed_review_v7_created',
    'assignment.mixed_review_v8_created'
  );

  if position(
    'private.create_assignment_with_delivery_v5('
    in function_definition
  ) > 0
    or position(
      'private.create_assignment_with_delivery_v6('
      in function_definition
    ) = 0
  then
    raise exception 'mixed_review_assignment_v8_rewrite_failed';
  end if;

  execute function_definition;
end;
$$;

create function public.create_mixed_review_assignment_v8(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_review_scope text,
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
  select private.create_mixed_review_assignment_v8(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_review_scope,
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

create function private.create_exact_review_assignment_v5(
  p_student_id uuid,
  p_dataset_id uuid,
  p_selected_queue_ids uuid[],
  p_title text,
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
  active_release_id uuid;
  selected_queue_count integer;
  created_assignment_id uuid;
  inserted_target_count integer;
  restored_queue_count integer;
  linked_queue_ids uuid[];
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_selected_queue_ids is null
    or cardinality(p_selected_queue_ids) not between 4 and 400
    or cardinality(p_selected_queue_ids) <> (
      select count(distinct queue_id)
      from unnest(p_selected_queue_ids) as input(queue_id)
      where queue_id is not null
    )
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <>
      cardinality(p_selected_queue_ids)
  then
    raise exception 'invalid_exact_review_selection'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
    and student.deleted_at is null
  for update;
  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.id = any(p_selected_queue_ids)
  order by queue.id
  for update;

  select count(*)
  into selected_queue_count
  from public.student_vocab_review_queue as queue
  where queue.id = any(p_selected_queue_ids)
    and queue.student_id = p_student_id
    and queue.dataset_id = p_dataset_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id is null;
  if selected_queue_count <> cardinality(p_selected_queue_ids) then
    raise exception 'exact_review_queue_snapshot_changed'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from unnest(p_selected_queue_ids) with ordinality
      as selected(queue_id, position)
    join public.student_vocab_review_queue as queue
      on queue.id = selected.queue_id
    left join jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer
    )
      on question.base_order_index = selected.position
     and question.vocab_entry_id = queue.vocab_entry_id
    where question.vocab_entry_id is null
  ) then
    raise exception 'exact_review_target_order_mismatch'
      using errcode = '22023';
  end if;

  select release.release_id
  into active_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
  limit 1;

  if active_release_id is null
    and exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    )
  then
    raise exception 'exam_use_release_inactive' using errcode = '55000';
  end if;

  if active_release_id is not null and exists (
    select 1
    from unnest(p_selected_queue_ids) as selected(queue_id)
    join public.student_vocab_review_queue as queue
      on queue.id = selected.queue_id
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = active_release_id
     and occurrence.dataset_id = queue.dataset_id
     and occurrence.vocab_entry_id = queue.vocab_entry_id
     and occurrence.include_in_exam
     and occurrence.exam_use_status = 'reviewed_for_preview'
    where occurrence.dictionary_id is null
      or (
        queue.canonical_dictionary_id_snapshot is not null
        and queue.canonical_dictionary_id_snapshot <>
          occurrence.dictionary_id
      )
      or (
        queue.source_exam_use_release_id_snapshot = active_release_id
        and queue.source_occurrence_id_snapshot is not null
        and queue.source_occurrence_id_snapshot <> occurrence.occurrence_id
      )
  ) then
    raise exception 'exact_review_dictionary_snapshot_changed'
      using errcode = '40001';
  end if;

  perform private.assert_assignment_words_available_v2(
    array[p_student_id],
    p_dataset_id,
    p_questions
  );

  created_assignment_id :=
    private.persist_review_assignment_exam_use_v6_compat(
      p_student_id,
      p_dataset_id,
      p_selected_queue_ids,
      null,
      p_title,
      array[]::uuid[],
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_questions
    );

  insert into public.assignment_review_targets (
    assignment_id,
    student_id,
    review_queue_id,
    assignment_question_id,
    dataset_id,
    vocab_entry_id,
    canonical_lexeme_id_snapshot,
    canonical_dictionary_id_snapshot
  )
  select
    created_assignment_id,
    p_student_id,
    queue.id,
    question.id,
    queue.dataset_id,
    queue.vocab_entry_id,
    coalesce(
      question.canonical_lexeme_id_snapshot,
      queue.canonical_lexeme_id_snapshot
    ),
    coalesce(
      snapshot.dictionary_id,
      queue.canonical_dictionary_id_snapshot
    )
  from unnest(p_selected_queue_ids) with ordinality
    as selected(queue_id, position)
  join public.student_vocab_review_queue as queue
    on queue.id = selected.queue_id
  join public.assignment_questions as question
    on question.assignment_id = created_assignment_id
   and question.base_order_index = selected.position
   and question.vocab_entry_id = queue.vocab_entry_id
  left join public.assignment_question_exam_use_snapshot as snapshot
    on snapshot.assignment_question_id = question.id
  order by selected.position;

  get diagnostics inserted_target_count = row_count;
  if inserted_target_count <> cardinality(p_selected_queue_ids) then
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
  where queue.id = any(p_selected_queue_ids)
    and queue.status = 'consumed'
    and queue.consumed_assignment_id = created_assignment_id;

  get diagnostics restored_queue_count = row_count;
  if restored_queue_count <> cardinality(p_selected_queue_ids) then
    raise exception 'assignment_review_queue_restore_mismatch'
      using errcode = '40001';
  end if;

  perform private.configure_assignment_delivery_v1(
    created_assignment_id,
    p_timing_mode,
    p_question_time_limit_seconds
  );

  select array_agg(
    target.review_queue_id
    order by question.base_order_index
  )
  into linked_queue_ids
  from public.assignment_review_targets as target
  join public.assignment_questions as question
    on question.id = target.assignment_question_id
   and question.assignment_id = target.assignment_id
  where target.assignment_id = created_assignment_id
    and target.student_id = p_student_id
    and target.released_at is null;

  if linked_queue_ids is distinct from p_selected_queue_ids then
    raise exception 'assignment_review_target_order_mismatch'
      using errcode = '21000';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.exact_review_v5_created',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'releaseId', active_release_id,
      'selectedQueueIds', to_jsonb(p_selected_queue_ids),
      'timingMode', p_timing_mode
    )
  );

  return created_assignment_id;
end;
$$;

-- Replacement v2 still constructs an internal draft before calling its exact
-- creator. Keep that private compatibility shape while routing persistence to
-- the exam-use dispatcher; no public draft endpoint is reopened.
create function private.create_exact_review_assignment_v5_draft_compat(
  p_review_draft_id uuid,
  p_title text,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_student_id uuid;
  draft_dataset_id uuid;
  review_queue_ids uuid[];
begin
  select draft.student_id, draft.dataset_id
  into draft_student_id, draft_dataset_id
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = p_review_draft_id;

  select array_agg(item.queue_id order by item.position)
  into review_queue_ids
  from public.student_vocab_review_assignment_draft_items as item
  where item.draft_id = p_review_draft_id;

  if draft_student_id is null
    or draft_dataset_id is null
    or review_queue_ids is null
  then
    raise exception 'review_assignment_draft_not_found'
      using errcode = '22023';
  end if;

  perform private.assert_assignment_words_available_v2(
    array[draft_student_id],
    draft_dataset_id,
    p_questions
  );

  return private.persist_review_assignment_exam_use_v6_compat(
    draft_student_id,
    draft_dataset_id,
    review_queue_ids,
    p_review_draft_id,
    p_title,
    array[]::uuid[],
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_questions
  );
end;
$$;

-- Reuse the reviewed bulk coordinator and replacement ledger while routing
-- their versioned creator calls through the dictionary-aware chain.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.create_bulk_vocab_assignments_v2(jsonb)'::regprocedure
  )
  into function_definition;

  if position(
    'private.create_assignment_with_delivery_v5('
    in function_definition
  ) = 0
    or position(
      'private.create_mixed_review_assignment_v7('
      in function_definition
    ) = 0
  then
    raise exception 'bulk_vocab_assignments_v2_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_bulk_vocab_assignments_v2(',
    'private.create_bulk_vocab_assignments_v3('
  );
  function_definition := replace(
    function_definition,
    'private.create_assignment_with_delivery_v5(',
    'private.create_assignment_with_delivery_v6('
  );
  function_definition := replace(
    function_definition,
    'private.create_mixed_review_assignment_v7(',
    'private.create_mixed_review_assignment_v8('
  );
  execute function_definition;
end;
$$;

create function public.create_bulk_vocab_assignments_v3(p_batches jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_bulk_vocab_assignments_v3(p_batches);
$$;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.replace_student_assignment_v2(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)'::regprocedure
  )
  into function_definition;

  if position(
    'private.create_assignment_with_delivery_v5('
    in function_definition
  ) = 0
    or position(
      'private.persist_review_assignment_v5('
      in function_definition
    ) = 0
    or position(
      'private.create_exact_review_assignment_v4('
      in function_definition
    ) = 0
  then
    raise exception 'replace_student_assignment_v2_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.replace_student_assignment_v2(',
    'private.replace_student_assignment_v3('
  );
  function_definition := replace(
    function_definition,
    'private.create_assignment_with_delivery_v5(',
    'private.create_assignment_with_delivery_v6('
  );
  function_definition := replace(
    function_definition,
    'private.assert_assignment_words_available_v1(',
    'private.assert_assignment_words_available_v2('
  );
  function_definition := replace(
    function_definition,
    'private.persist_review_assignment_v5(',
    'private.persist_review_assignment_exam_use_v6_compat('
  );
  function_definition := replace(
    function_definition,
    'private.create_exact_review_assignment_v4(',
    'private.create_exact_review_assignment_v5_draft_compat('
  );
  execute function_definition;
end;
$$;

create function public.replace_student_assignment_v3(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
  p_review_snapshot_mode text,
  p_title text,
  p_dataset_id uuid,
  p_primary_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.replace_student_assignment_v3(
    p_source_assignment_id,
    p_student_id,
    p_idempotency_key,
    p_request_sha256,
    p_replacement_kind,
    p_review_snapshot_mode,
    p_title,
    p_dataset_id,
    p_primary_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_review_levels,
    p_selected_queue_ids,
    p_questions
  );
$$;

create function public.list_assignment_question_dictionary_identities_v1(
  p_assignment_ids uuid[],
  p_dataset_id uuid
)
returns table (
  assignment_id uuid,
  vocab_entry_id bigint,
  canonical_dictionary_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_assignment_ids is null
    or cardinality(p_assignment_ids) not between 1 and 100
    or cardinality(p_assignment_ids) <> (
      select count(distinct input.requested_assignment_id)
      from unnest(p_assignment_ids) as input(requested_assignment_id)
      where input.requested_assignment_id is not null
    )
    or p_dataset_id is null
  then
    raise exception 'invalid_assignment_dictionary_identity_query'
      using errcode = '22023';
  end if;

  return query
  select
    snapshot.assignment_id,
    snapshot.vocab_entry_id,
    snapshot.dictionary_id
  from public.assignment_question_exam_use_snapshot as snapshot
  where snapshot.assignment_id = any(p_assignment_ids)
    and snapshot.dataset_id = p_dataset_id
  order by snapshot.assignment_id, snapshot.vocab_entry_id;
end;
$$;

-- Private helpers are callable only from versioned server paths. Public
-- wrappers expose only the normal admin RPC surface.
revoke all on function private.snapshot_wrong_event_exam_use_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.snapshot_review_queue_exam_use_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.snapshot_vocab_state_dictionary_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.snapshot_review_target_dictionary_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.vocab_identity_matches_v1(
  uuid, bigint, text, uuid, text,
  uuid, bigint, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function private.vocab_identity_matches_v1(
  uuid, bigint, text, uuid, text,
  uuid, bigint, text, uuid, text
) to authenticated, service_role;
revoke all on function private.resolve_vocab_state_on_correct_answer()
  from public, anon, authenticated, service_role;
revoke all on function private.reopen_selected_vocab_review_queue_v1(
  uuid, bigint, integer
) from public, anon, authenticated, service_role;
revoke all on function
  private.reopen_selected_vocab_review_queue_after_missed_target()
  from public, anon, authenticated, service_role;
revoke all on function private.release_review_targets_on_attempt_terminal()
  from public, anon, authenticated, service_role;
revoke all on function private.assert_assignment_words_available_v2(
  uuid[], uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.link_pending_review_targets_v2(
  uuid, uuid[], uuid[]
) from public, anon, authenticated, service_role;
revoke all on function
  private.create_assignment_with_question_bank_exam_use_dispatch_v1(
    text, uuid, uuid[], integer, smallint, integer, smallint,
    public.question_order_mode, timestamptz, uuid[], jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function
  private.persist_review_assignment_exam_use_v6_compat(
    uuid, uuid, uuid[], uuid, text, uuid[], smallint, integer, smallint,
    public.question_order_mode, timestamptz, jsonb
  ) from public, anon, authenticated, service_role;
revoke all on function private.create_exact_review_assignment_v5(
  uuid, uuid, uuid[], text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_exact_review_assignment_v5_draft_compat(
  uuid, text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;

revoke all on function private.create_assignment_with_delivery_v6(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_assignment_with_delivery_v6(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;
revoke all on function public.create_assignment_with_delivery_v6(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_assignment_with_delivery_v6(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;

revoke all on function private.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

revoke all on function private.create_bulk_vocab_assignments_v3(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.create_bulk_vocab_assignments_v3(jsonb)
  to authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v3(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v3(jsonb)
  to authenticated, service_role;

revoke all on function private.replace_student_assignment_v3(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.replace_student_assignment_v3(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) to authenticated, service_role;
revoke all on function public.replace_student_assignment_v3(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_student_assignment_v3(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) to authenticated, service_role;

revoke all on function
  public.list_assignment_question_dictionary_identities_v1(uuid[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.list_assignment_question_dictionary_identities_v1(uuid[], uuid)
  to authenticated, service_role;

-- Retire the previous externally callable creators after every application
-- call site has moved to the dictionary-aware version. This prevents a direct
-- RPC call from bypassing the new duplicate and occurrence checks.
revoke all on function private.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from authenticated, service_role;
revoke all on function public.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from authenticated, service_role;
revoke all on function private.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v2(jsonb)
  from authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v2(jsonb)
  from authenticated, service_role;
revoke all on function private.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from authenticated, service_role;
revoke all on function public.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from authenticated, service_role;

notify pgrst, 'reload schema';

commit;
