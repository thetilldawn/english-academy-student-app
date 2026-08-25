begin;

-- Existing attempts deliberately stay null so this migration does not assign
-- points to historical work. Only attempts created after this default exists
-- snapshot the first point rule.
alter table public.quiz_attempts
  add column point_rule_version_snapshot text;

alter table public.quiz_attempts
  add constraint quiz_attempts_point_rule_version_snapshot_check
  check (
    point_rule_version_snapshot is null
    or point_rule_version_snapshot ~ '^[a-z0-9][a-z0-9._-]{2,79}$'
  );

alter table public.quiz_attempts
  alter column point_rule_version_snapshot
  set default 'vocab-points-v1';

create function private.default_quiz_attempt_point_rule_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.point_rule_version_snapshot is null then
    new.point_rule_version_snapshot := 'vocab-points-v1';
  end if;

  return new;
end;
$$;

create trigger quiz_attempts_default_point_rule_snapshot
before insert on public.quiz_attempts
for each row
execute function private.default_quiz_attempt_point_rule_snapshot();

create function private.preserve_quiz_attempt_point_rule_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.point_rule_version_snapshot is distinct from
      old.point_rule_version_snapshot then
    raise exception 'point_rule_snapshot_is_immutable'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger quiz_attempts_preserve_point_rule_snapshot
before update of point_rule_version_snapshot on public.quiz_attempts
for each row
execute function private.preserve_quiz_attempt_point_rule_snapshot();

create function private.vocab_quiz_point_delta_v1(
  p_exam_kind text,
  p_stage text,
  p_outcome text
)
returns smallint
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_exam_kind = 'regular'
      and p_stage = 'initial'
      and p_outcome = 'correct'
      then 2
    when p_exam_kind = 'regular'
      and p_stage = 'initial'
      then -3
    when p_exam_kind = 'regular'
      and p_stage = 'retry'
      and p_outcome = 'correct'
      then 2
    when p_exam_kind = 'regular'
      and p_stage = 'retry'
      then 0
    when p_exam_kind = 'review'
      and p_stage = 'initial'
      and p_outcome = 'correct'
      then 2
    when p_exam_kind = 'review'
      and p_stage = 'initial'
      then 0
    when p_exam_kind = 'review'
      and p_stage = 'retry'
      and p_outcome = 'correct'
      then 1
    when p_exam_kind = 'review'
      and p_stage = 'retry'
      then 0
  end::smallint;
$$;

create table public.student_point_events (
  id bigint generated always as identity primary key,
  event_key text not null unique
    check (char_length(event_key) between 1 and 200),
  event_kind text not null
    check (event_kind in ('quiz_outcome', 'adjustment')),
  student_id uuid not null
    references public.students(id) on delete restrict,
  dataset_id_snapshot uuid,
  vocab_entry_id_snapshot bigint,
  canonical_lexeme_id_snapshot uuid,
  headword_snapshot text,
  assignment_id uuid,
  quiz_attempt_id uuid,
  quiz_question_id uuid,
  stage text check (stage in ('initial', 'retry')),
  exam_kind text check (exam_kind in ('regular', 'review')),
  outcome text
    check (outcome in ('correct', 'wrong', 'unanswered', 'timeout')),
  rule_version text not null
    check (rule_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  reason_code text not null
    check (reason_code ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),
  delta smallint not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint student_point_events_quiz_outcome_shape check (
    event_kind <> 'quiz_outcome'
    or (
      dataset_id_snapshot is not null
      and vocab_entry_id_snapshot is not null
      and headword_snapshot is not null
      and assignment_id is not null
      and quiz_attempt_id is not null
      and quiz_question_id is not null
      and stage is not null
      and exam_kind is not null
      and outcome is not null
      and rule_version = 'vocab-points-v1'
      and delta = private.vocab_quiz_point_delta_v1(
        exam_kind,
        stage,
        outcome
      )
    )
  )
);

create unique index student_point_events_quiz_question_stage_unique
  on public.student_point_events (quiz_question_id, stage)
  where event_kind = 'quiz_outcome';
create index student_point_events_student_time_idx
  on public.student_point_events (student_id, occurred_at desc, id desc);
create index student_point_events_attempt_idx
  on public.student_point_events (quiz_attempt_id, id)
  where quiz_attempt_id is not null;
create index student_point_events_assignment_idx
  on public.student_point_events (assignment_id, student_id)
  where assignment_id is not null;
create index student_point_events_canonical_idx
  on public.student_point_events (
    student_id,
    canonical_lexeme_id_snapshot,
    occurred_at desc
  )
  where canonical_lexeme_id_snapshot is not null;

create table public.student_point_totals (
  student_id uuid primary key
    references public.students(id) on delete restrict,
  total_points bigint not null default 0,
  event_count bigint not null default 0 check (event_count >= 0),
  last_event_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create function private.update_student_point_totals_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.student_point_totals (
    student_id,
    total_points,
    event_count,
    last_event_at,
    updated_at
  )
  select
    inserted.student_id,
    sum(inserted.delta)::bigint,
    count(*)::bigint,
    max(inserted.occurred_at),
    clock_timestamp()
  from inserted_point_events as inserted
  group by inserted.student_id
  on conflict (student_id) do update
  set
    total_points = public.student_point_totals.total_points
      + excluded.total_points,
    event_count = public.student_point_totals.event_count
      + excluded.event_count,
    last_event_at = greatest(
      public.student_point_totals.last_event_at,
      excluded.last_event_at
    ),
    updated_at = clock_timestamp();

  return null;
end;
$$;

create trigger student_point_events_update_totals
after insert on public.student_point_events
referencing new table as inserted_point_events
for each statement
execute function private.update_student_point_totals_after_insert();

create function private.reject_student_point_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'point_events_are_append_only' using errcode = '55000';
end;
$$;

create trigger student_point_events_reject_mutation
before update or delete on public.student_point_events
for each row
execute function private.reject_student_point_event_mutation();

create function private.record_vocab_quiz_point_events(
  p_attempt_id uuid,
  p_student_id uuid,
  p_rule_version text,
  p_fallback_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if p_rule_version is null then
    return 0;
  end if;

  if p_rule_version <> 'vocab-points-v1' then
    raise exception 'unsupported_point_rule_version'
      using errcode = '22023';
  end if;

  with point_candidates as (
    select
      question.id as quiz_question_id,
      attempt.assignment_id,
      attempt.student_id,
      assignment.dataset_id,
      question.vocab_entry_id,
      bank_question.canonical_lexeme_id_snapshot,
      coalesce(bank_question.headword_snapshot, entry.headword)
        as headword_snapshot,
      stage.stage,
      case
        when assignment.assignment_purpose = 'review'
          or exists (
            select 1
            from public.assignment_review_targets as review_target
            where review_target.assignment_id = attempt.assignment_id
              and review_target.student_id = attempt.student_id
              and review_target.assignment_question_id =
                question.assignment_question_id
          )
          then 'review'::text
        else 'regular'::text
      end as exam_kind,
      case
        when stage.is_correct then 'correct'::text
        when stage.choice_index is null then 'unanswered'::text
        when stage.timed_out then 'timeout'::text
        else 'wrong'::text
      end as outcome,
      coalesce(stage.answered_at, p_fallback_at, clock_timestamp())
        as occurred_at
    from public.quiz_attempts as attempt
    join public.assignments as assignment
      on assignment.id = attempt.assignment_id
    join public.quiz_questions as question
      on question.attempt_id = attempt.id
    join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
    left join public.assignment_questions as bank_question
      on bank_question.id = question.assignment_question_id
    cross join lateral (
      values
        (
          'initial'::text,
          question.initial_choice_index,
          question.initial_is_correct,
          question.initial_timed_out,
          question.initial_answered_at
        ),
        (
          'retry'::text,
          question.retry_choice_index,
          question.retry_is_correct,
          question.retry_timed_out,
          question.retry_answered_at
        )
    ) as stage(
      stage,
      choice_index,
      is_correct,
      timed_out,
      answered_at
    )
    where attempt.id = p_attempt_id
      and attempt.student_id = p_student_id
      and stage.is_correct is not null
  ), inserted_events as (
    insert into public.student_point_events (
      event_key,
      event_kind,
      student_id,
      dataset_id_snapshot,
      vocab_entry_id_snapshot,
      canonical_lexeme_id_snapshot,
      headword_snapshot,
      assignment_id,
      quiz_attempt_id,
      quiz_question_id,
      stage,
      exam_kind,
      outcome,
      rule_version,
      reason_code,
      delta,
      occurred_at
    )
    select
      'vocab-quiz-outcome:' || candidate.quiz_question_id::text
        || ':' || candidate.stage,
      'quiz_outcome',
      candidate.student_id,
      candidate.dataset_id,
      candidate.vocab_entry_id,
      candidate.canonical_lexeme_id_snapshot,
      candidate.headword_snapshot,
      candidate.assignment_id,
      p_attempt_id,
      candidate.quiz_question_id,
      candidate.stage,
      candidate.exam_kind,
      candidate.outcome,
      p_rule_version,
      candidate.exam_kind || '_' || candidate.stage || '_'
        || candidate.outcome,
      private.vocab_quiz_point_delta_v1(
        candidate.exam_kind,
        candidate.stage,
        candidate.outcome
      ),
      candidate.occurred_at
    from point_candidates as candidate
    on conflict do nothing
    returning 1
  )
  select count(*)::integer
  into inserted_count
  from inserted_events;

  return inserted_count;
end;
$$;

create function private.record_student_point_events_after_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.point_rule_version_snapshot is null then
    return new;
  end if;

  perform private.record_vocab_quiz_point_events(
    new.id,
    new.student_id,
    new.point_rule_version_snapshot,
    coalesce(new.completed_at, new.initial_completed_at, clock_timestamp())
  );

  return new;
end;
$$;

create constraint trigger quiz_attempts_record_student_point_events
after update of phase, status on public.quiz_attempts
deferrable initially deferred
for each row
when (
  (
    old.phase = 'initial'
    and new.phase = 'review'
  )
  or (
    old.status = 'in_progress'
    and new.status in ('completed', 'expired')
  )
)
execute function private.record_student_point_events_after_attempt_transition();

alter table public.student_point_events enable row level security;
alter table public.student_point_totals enable row level security;

create policy "active admins can read student point events"
on public.student_point_events
for select
to authenticated
using ((select private.is_active_admin()));

create policy "active admins can read student point totals"
on public.student_point_totals
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.student_point_events
  from public, anon, authenticated, service_role;
revoke all on table public.student_point_totals
  from public, anon, authenticated, service_role;
revoke all on sequence public.student_point_events_id_seq
  from public, anon, authenticated, service_role;
grant select on table public.student_point_events
  to authenticated, service_role;
grant select on table public.student_point_totals
  to authenticated, service_role;

revoke all on function private.vocab_quiz_point_delta_v1(
  text,
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function private.default_quiz_attempt_point_rule_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function private.preserve_quiz_attempt_point_rule_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function private.update_student_point_totals_after_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_student_point_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.record_vocab_quiz_point_events(
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function
  private.record_student_point_events_after_attempt_transition()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
