begin;

create or replace function private.finalize_expired_quiz_attempt(
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  question_total integer;
  initial_correct integer;
  retry_correct integer;
  unresolved_wrong integer;
  initial_score_value numeric(5,2);
  final_score_value numeric(5,2);
  evaluation_time timestamptz;
  state_evaluation_time timestamptz;
  elapsed_seconds_value integer;
begin
  select *
    into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  if attempt_row.status = 'completed' then
    return jsonb_build_object('completed', true, 'expired', false);
  end if;

  if attempt_row.status = 'expired' then
    return jsonb_build_object('completed', true, 'expired', true);
  end if;

  if attempt_row.phase = 'review' then
    raise exception 'attempt_review_not_timed' using errcode = '22023';
  end if;

  if attempt_row.deadline_at > now() then
    raise exception 'attempt_not_expired' using errcode = '22023';
  end if;

  evaluation_time := clock_timestamp();
  state_evaluation_time := attempt_row.deadline_at;

  -- Keep the missing choice visible as "선택 안 함", but give every expired
  -- question one explicit correctness state before scores, wrong events, and
  -- current wrong-word state are derived.
  update public.quiz_questions
  set initial_is_correct = false,
      initial_answered_at = attempt_row.deadline_at,
      initial_timed_out = true
  where attempt_id = p_attempt_id
    and initial_choice_index is null
    and initial_is_correct is null;

  if attempt_row.phase = 'retry' then
    update public.quiz_questions
    set retry_is_correct = false,
        retry_answered_at = attempt_row.deadline_at,
        retry_timed_out = true
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and retry_choice_index is null
      and retry_is_correct is null;
  end if;

  select
    count(*),
    count(*) filter (where initial_is_correct is true),
    count(*) filter (
      where initial_is_correct is false
        and retry_is_correct is true
    ),
    count(*) filter (
      where coalesce(initial_is_correct, false) is false
        and coalesce(retry_is_correct, false) is false
    )
  into
    question_total,
    initial_correct,
    retry_correct,
    unresolved_wrong
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  if question_total = 0 then
    raise exception 'attempt_has_no_questions' using errcode = '22023';
  end if;

  initial_score_value := round(
    (initial_correct::numeric / question_total) * 100,
    2
  );
  final_score_value := round(
    ((initial_correct + retry_correct)::numeric / question_total) * 100,
    2
  );
  elapsed_seconds_value := case
    when attempt_row.phase = 'retry'
      and attempt_row.initial_completed_at is not null
      and attempt_row.retry_started_at is not null
    then
      greatest(
        0,
        floor(
          extract(
            epoch from (
              attempt_row.initial_completed_at - attempt_row.started_at
            )
          )
        )::integer
      )
      + greatest(
        0,
        floor(
          extract(
            epoch from (
              attempt_row.deadline_at - attempt_row.retry_started_at
            )
          )
        )::integer
      )
    else greatest(
      0,
      floor(
        extract(epoch from (attempt_row.deadline_at - attempt_row.started_at))
      )::integer
    )
  end;

  update public.quiz_attempts
  set status = 'expired',
      phase = 'completed',
      completed_at = evaluation_time,
      initial_correct_count = initial_correct,
      retry_correct_count = retry_correct,
      unresolved_wrong_count = unresolved_wrong,
      initial_score = initial_score_value,
      final_score = final_score_value,
      passed = false,
      elapsed_seconds = elapsed_seconds_value
  where id = p_attempt_id;

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
    p_student_id,
    vocab_entry_id,
    1,
    state_evaluation_time,
    null,
    p_attempt_id,
    state_evaluation_time
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and initial_is_correct is false
    and coalesce(retry_is_correct, false) is false
  on conflict (student_id, vocab_entry_id)
  do update set
    unresolved_wrong_count =
      public.student_vocab_state.unresolved_wrong_count + 1,
    last_wrong_at = excluded.last_wrong_at,
    resolved_at = null,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at
    >= public.student_vocab_state.last_evaluated_at;

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    unresolved_wrong_count,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  select
    p_student_id,
    vocab_entry_id,
    0,
    state_evaluation_time,
    p_attempt_id,
    state_evaluation_time
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and (
      initial_is_correct is true
      or retry_is_correct is true
    )
  on conflict (student_id, vocab_entry_id)
  do update set
    unresolved_wrong_count = 0,
    resolved_at = excluded.resolved_at,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at
    >= public.student_vocab_state.last_evaluated_at;

  return jsonb_build_object(
    'completed', true,
    'expired', true,
    'initialScore', initial_score_value,
    'finalScore', final_score_value
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
