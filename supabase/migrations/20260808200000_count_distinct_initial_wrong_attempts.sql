begin;

create or replace function private.snapshot_prior_wrong_count()
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

  select count(distinct wrong_event.quiz_attempt_id)::integer
  into new.prior_wrong_count
  from public.student_vocab_wrong_events as wrong_event
  join public.quiz_attempts as source_attempt
    on source_attempt.id = wrong_event.quiz_attempt_id
  where wrong_event.student_id = attempt_student_id
    and wrong_event.wrong_stage = 'initial'
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

update public.quiz_questions as question
set prior_wrong_count = (
  select count(distinct wrong_event.quiz_attempt_id)::integer
  from public.student_vocab_wrong_events as wrong_event
  join public.quiz_attempts as source_attempt
    on source_attempt.id = wrong_event.quiz_attempt_id
  join public.quiz_attempts as target_attempt
    on target_attempt.id = question.attempt_id
  left join public.assignment_questions as target_bank_question
    on target_bank_question.id = question.assignment_question_id
  where wrong_event.student_id = target_attempt.student_id
    and wrong_event.wrong_stage = 'initial'
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

revoke all on function private.snapshot_prior_wrong_count() from public;
revoke all on function private.snapshot_prior_wrong_count() from anon;
revoke all on function private.snapshot_prior_wrong_count() from authenticated;

commit;
