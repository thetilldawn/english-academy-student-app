begin;

create table public.student_vocab_wrong_events (
  id bigint generated always as identity primary key,
  student_id uuid not null
    references public.students(id) on delete restrict,
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  vocab_entry_id bigint not null,
  canonical_lexeme_id_snapshot uuid,
  quiz_attempt_id uuid not null
    references public.quiz_attempts(id) on delete restrict,
  quiz_question_id uuid not null
    references public.quiz_questions(id) on delete restrict,
  wrong_stage text not null
    check (wrong_stage in ('initial', 'retry')),
  wrong_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete restrict,
  unique (quiz_question_id, wrong_stage)
);

create index student_vocab_wrong_events_student_vocab_time_idx
  on public.student_vocab_wrong_events (
    student_id,
    vocab_entry_id,
    wrong_at desc
  );
create index student_vocab_wrong_events_attempt_idx
  on public.student_vocab_wrong_events (quiz_attempt_id);
create index student_vocab_wrong_events_dataset_entry_idx
  on public.student_vocab_wrong_events (dataset_id, vocab_entry_id);
create index student_vocab_wrong_events_student_canonical_time_idx
  on public.student_vocab_wrong_events (
    student_id,
    canonical_lexeme_id_snapshot,
    wrong_at desc
  )
  where canonical_lexeme_id_snapshot is not null;

alter table public.quiz_questions
  add column prior_wrong_count integer not null default 0
    check (prior_wrong_count >= 0);

create function private.record_wrong_events_for_attempt(
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
  insert into public.student_vocab_wrong_events (
    student_id,
    dataset_id,
    vocab_entry_id,
    canonical_lexeme_id_snapshot,
    quiz_attempt_id,
    quiz_question_id,
    wrong_stage,
    wrong_at
  )
  select
    p_student_id,
    entry.dataset_id,
    question.vocab_entry_id,
    bank_question.canonical_lexeme_id_snapshot,
    p_attempt_id,
    question.id,
    stage.wrong_stage,
    coalesce(stage.wrong_at, p_completed_at)
  from public.quiz_questions as question
  join public.vocab_entries as entry
    on entry.id = question.vocab_entry_id
  left join public.assignment_questions as bank_question
    on bank_question.id = question.assignment_question_id
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
  where question.attempt_id = p_attempt_id
    and stage.is_correct is false
  on conflict (quiz_question_id, wrong_stage) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create function private.record_wrong_events_after_attempt_finish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_wrong_events_for_attempt(
    new.id,
    new.student_id,
    new.completed_at
  );
  return new;
end;
$$;

create trigger quiz_attempts_record_wrong_events
after update of status on public.quiz_attempts
for each row
when (
  old.status = 'in_progress'
  and new.status in ('completed', 'expired')
)
execute function private.record_wrong_events_after_attempt_finish();

insert into public.student_vocab_wrong_events (
  student_id,
  dataset_id,
  vocab_entry_id,
  canonical_lexeme_id_snapshot,
  quiz_attempt_id,
  quiz_question_id,
  wrong_stage,
  wrong_at
)
select
  attempt.student_id,
  entry.dataset_id,
  question.vocab_entry_id,
  bank_question.canonical_lexeme_id_snapshot,
  attempt.id,
  question.id,
  stage.wrong_stage,
  coalesce(stage.wrong_at, attempt.completed_at)
from public.quiz_attempts as attempt
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
      question.initial_is_correct,
      question.initial_answered_at
    ),
    (
      'retry'::text,
      question.retry_is_correct,
      question.retry_answered_at
    )
) as stage(wrong_stage, is_correct, wrong_at)
where attempt.status in ('completed', 'expired')
  and stage.is_correct is false
on conflict (quiz_question_id, wrong_stage) do nothing;

create function private.snapshot_prior_wrong_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_student_id uuid;
  attempt_started_at timestamptz;
  current_canonical_lexeme_id uuid;
begin
  select
    attempt.student_id,
    attempt.started_at
  into
    attempt_student_id,
    attempt_started_at
  from public.quiz_attempts as attempt
  where attempt.id = new.attempt_id;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  select bank_question.canonical_lexeme_id_snapshot
  into current_canonical_lexeme_id
  from public.assignment_questions as bank_question
  where bank_question.id = new.assignment_question_id;

  select count(*)::integer
  into new.prior_wrong_count
  from public.student_vocab_wrong_events as wrong_event
  join public.quiz_attempts as source_attempt
    on source_attempt.id = wrong_event.quiz_attempt_id
  where wrong_event.student_id = attempt_student_id
    and source_attempt.status in ('completed', 'expired')
    and source_attempt.completed_at < attempt_started_at
    and (
      (
        current_canonical_lexeme_id is not null
        and wrong_event.canonical_lexeme_id_snapshot =
          current_canonical_lexeme_id
      )
      or (
        (
          current_canonical_lexeme_id is null
          or wrong_event.canonical_lexeme_id_snapshot is null
        )
        and wrong_event.vocab_entry_id = new.vocab_entry_id
      )
    );

  return new;
end;
$$;

create trigger quiz_questions_snapshot_prior_wrong_count
before insert on public.quiz_questions
for each row
execute function private.snapshot_prior_wrong_count();

update public.quiz_questions as question
set prior_wrong_count = (
  select count(*)::integer
  from public.student_vocab_wrong_events as wrong_event
  join public.quiz_attempts as source_attempt
    on source_attempt.id = wrong_event.quiz_attempt_id
  join public.quiz_attempts as target_attempt
    on target_attempt.id = question.attempt_id
  left join public.assignment_questions as target_bank_question
    on target_bank_question.id = question.assignment_question_id
  where wrong_event.student_id = target_attempt.student_id
    and source_attempt.status in ('completed', 'expired')
    and source_attempt.completed_at < target_attempt.started_at
    and (
      (
        target_bank_question.canonical_lexeme_id_snapshot is not null
        and wrong_event.canonical_lexeme_id_snapshot =
          target_bank_question.canonical_lexeme_id_snapshot
      )
      or (
        (
          target_bank_question.canonical_lexeme_id_snapshot is null
          or wrong_event.canonical_lexeme_id_snapshot is null
        )
        and wrong_event.vocab_entry_id = question.vocab_entry_id
      )
    )
);

alter table public.student_vocab_wrong_events enable row level security;

create policy "active admins can read student vocab wrong events"
on public.student_vocab_wrong_events
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.student_vocab_wrong_events
  from public, anon, authenticated;
grant select on table public.student_vocab_wrong_events
  to authenticated;
grant all on table public.student_vocab_wrong_events
  to service_role;

revoke all on function private.record_wrong_events_for_attempt(
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;
revoke all on function private.record_wrong_events_after_attempt_finish()
  from public, anon, authenticated;
revoke all on function private.snapshot_prior_wrong_count()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
