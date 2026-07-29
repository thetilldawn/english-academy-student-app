create type public.attempt_phase as enum (
  'initial',
  'review',
  'retry',
  'completed'
);

alter table public.quiz_attempts
  add column phase public.attempt_phase not null default 'initial',
  add column initial_completed_at timestamptz,
  add column retry_started_at timestamptz;

alter table public.quiz_attempts
  drop constraint quiz_attempts_state_consistency;

update public.quiz_attempts as attempt
set phase = case
  when attempt.status in ('completed', 'expired') then 'completed'::public.attempt_phase
  when not exists (
    select 1
    from public.quiz_questions as question
    where question.attempt_id = attempt.id
      and question.initial_choice_index is null
  )
  and exists (
    select 1
    from public.quiz_questions as question
    where question.attempt_id = attempt.id
      and question.initial_is_correct is false
      and question.retry_choice_index is null
  ) then 'retry'::public.attempt_phase
  else 'initial'::public.attempt_phase
end;

update public.quiz_attempts as attempt
set initial_completed_at = coalesce(
  (
    select max(question.initial_answered_at)
    from public.quiz_questions as question
    where question.attempt_id = attempt.id
  ),
  attempt.started_at
)
where exists (
    select 1
    from public.quiz_questions as question
    where question.attempt_id = attempt.id
  )
  and not exists (
    select 1
    from public.quiz_questions as question
    where question.attempt_id = attempt.id
      and question.initial_choice_index is null
  );

update public.quiz_attempts as attempt
set retry_started_at = coalesce(
  attempt.initial_completed_at,
  (
    select min(question.retry_answered_at)
    from public.quiz_questions as question
    where question.attempt_id = attempt.id
  ),
  attempt.started_at
)
where attempt.phase = 'retry';

with retry_metrics as (
  select
    attempt.id,
    count(question.id) as question_total,
    count(question.id) filter (
      where question.initial_is_correct is true
    ) as initial_correct,
    count(question.id) filter (
      where question.initial_is_correct is false
        and question.retry_is_correct is true
    ) as retry_correct,
    greatest(
      0,
      floor(
        extract(
          epoch from (
            least(now(), attempt.deadline_at) - attempt.started_at
          )
        )
      )::integer
    ) as elapsed_seconds
  from public.quiz_attempts as attempt
  join public.quiz_questions as question
    on question.attempt_id = attempt.id
  where attempt.phase = 'retry'
  group by attempt.id, attempt.deadline_at, attempt.started_at
)
update public.quiz_attempts as attempt
set initial_correct_count = metrics.initial_correct,
    retry_correct_count = metrics.retry_correct,
    unresolved_wrong_count =
      metrics.question_total
      - metrics.initial_correct
      - metrics.retry_correct,
    initial_score = round(
      (metrics.initial_correct::numeric / metrics.question_total) * 100,
      2
    ),
    elapsed_seconds = metrics.elapsed_seconds
from retry_metrics as metrics
where attempt.id = metrics.id;

alter table public.quiz_attempts
  add constraint quiz_attempts_phase_status_consistency check (
    (
      status = 'in_progress'
      and phase in ('initial', 'review', 'retry')
    )
    or (
      status in ('completed', 'expired')
      and phase = 'completed'
    )
  ),
  add constraint quiz_attempts_review_timestamp_consistency check (
    phase <> 'review'
    or (
      status = 'in_progress'
      and initial_completed_at is not null
      and retry_started_at is null
    )
  ),
  add constraint quiz_attempts_retry_timestamp_consistency check (
    phase <> 'retry'
    or (
      status = 'in_progress'
      and initial_completed_at is not null
      and retry_started_at is not null
    )
  ),
  add constraint quiz_attempts_state_consistency check (
    (
      status = 'in_progress'
      and phase = 'initial'
      and completed_at is null
      and initial_correct_count is null
      and retry_correct_count is null
      and unresolved_wrong_count is null
      and initial_score is null
      and final_score is null
      and passed is null
      and elapsed_seconds is null
    )
    or (
      status = 'in_progress'
      and phase in ('review', 'retry')
      and completed_at is null
      and initial_correct_count is not null
      and retry_correct_count is not null
      and unresolved_wrong_count is not null
      and initial_correct_count
        + retry_correct_count
        + unresolved_wrong_count
        = question_count_snapshot
      and initial_score is not null
      and final_score is null
      and passed is null
      and elapsed_seconds is not null
    )
    or (
      status in ('completed', 'expired')
      and phase = 'completed'
      and completed_at is not null
      and initial_correct_count is not null
      and retry_correct_count is not null
      and unresolved_wrong_count is not null
      and initial_correct_count
        + retry_correct_count
        + unresolved_wrong_count
        = question_count_snapshot
      and initial_score is not null
      and final_score is not null
      and final_score >= initial_score
      and passed is not null
      and elapsed_seconds is not null
    )
  );

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
  evaluation_time := clock_timestamp();
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
    evaluation_time,
    null,
    p_attempt_id,
    evaluation_time
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and initial_choice_index is not null
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
    evaluation_time,
    p_attempt_id,
    evaluation_time
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

create or replace function public.answer_quiz_question(
  p_student_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_phase text,
  p_choice_index smallint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  question_row public.quiz_questions%rowtype;
  answer_correct boolean;
  initial_unanswered integer;
  retry_unanswered integer;
  initial_wrong integer;
  question_total integer;
  initial_correct integer;
  retry_correct integer;
  unresolved_wrong integer;
  initial_score_value numeric(5,2);
  final_score_value numeric(5,2);
  evaluation_time timestamptz;
  elapsed_seconds_value integer;
  completed_now boolean := false;
  review_required boolean := false;
  next_question_id uuid;
  next_phase text;
begin
  if p_choice_index is null
    or p_choice_index < 0
    or p_choice_index > 3
  then
    raise exception 'invalid_choice' using errcode = '22023';
  end if;

  if p_phase is null or p_phase not in ('initial', 'retry') then
    raise exception 'invalid_phase' using errcode = '22023';
  end if;

  select *
  into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;

  if attempt_row.phase = 'review' then
    raise exception 'retry_not_started' using errcode = '22023';
  end if;

  if attempt_row.phase::text <> p_phase then
    raise exception 'attempt_phase_mismatch' using errcode = '22023';
  end if;

  if attempt_row.deadline_at <= now() then
    return private.finalize_expired_quiz_attempt(
      p_student_id,
      p_attempt_id
    );
  end if;

  select *
  into question_row
  from public.quiz_questions
  where id = p_question_id
    and attempt_id = p_attempt_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  answer_correct := p_choice_index = question_row.correct_choice_index;

  if p_phase = 'initial' then
    if question_row.initial_choice_index is not null then
      if question_row.initial_choice_index = p_choice_index then
        answer_correct := question_row.initial_is_correct;
      else
        raise exception 'question_already_answered' using errcode = '22023';
      end if;
    else
      if question_row.order_index is distinct from (
        select min(order_index)
        from public.quiz_questions
        where attempt_id = p_attempt_id
          and initial_choice_index is null
      ) then
        raise exception 'question_out_of_order' using errcode = '22023';
      end if;

      update public.quiz_questions
      set initial_choice_index = p_choice_index,
          initial_is_correct = answer_correct,
          initial_answered_at = now()
      where id = p_question_id;
    end if;
  else
    if exists (
      select 1
      from public.quiz_questions
      where attempt_id = p_attempt_id
        and initial_choice_index is null
    ) then
      raise exception 'initial_phase_incomplete' using errcode = '22023';
    end if;

    if question_row.initial_is_correct is not false then
      raise exception 'retry_not_required' using errcode = '22023';
    end if;

    if question_row.retry_choice_index is not null then
      if question_row.retry_choice_index = p_choice_index then
        answer_correct := question_row.retry_is_correct;
      else
        raise exception 'retry_already_answered' using errcode = '22023';
      end if;
    else
      if question_row.order_index is distinct from (
        select min(order_index)
        from public.quiz_questions
        where attempt_id = p_attempt_id
          and initial_is_correct is false
          and retry_choice_index is null
      ) then
        raise exception 'retry_out_of_order' using errcode = '22023';
      end if;

      update public.quiz_questions
      set retry_choice_index = p_choice_index,
          retry_is_correct = answer_correct,
          retry_answered_at = now()
      where id = p_question_id;
    end if;
  end if;

  select
    count(*),
    count(*) filter (where initial_choice_index is null),
    count(*) filter (
      where initial_is_correct is false
        and retry_choice_index is null
    ),
    count(*) filter (where initial_is_correct is false),
    count(*) filter (
      where initial_is_correct is false
        and retry_is_correct is true
    )
  into
    question_total,
    initial_unanswered,
    retry_unanswered,
    initial_wrong,
    retry_correct
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  completed_now :=
    (
      p_phase = 'initial'
      and initial_unanswered = 0
      and initial_wrong = 0
    )
    or (
      p_phase = 'retry'
      and retry_unanswered = 0
    );

  review_required :=
    p_phase = 'initial'
    and initial_unanswered = 0
    and initial_wrong > 0;

  if completed_now then
    select
      count(*),
      count(*) filter (where initial_is_correct is true),
      count(*) filter (
        where initial_is_correct is false
          and retry_is_correct is true
      ),
      count(*) filter (
        where initial_is_correct is false
          and coalesce(retry_is_correct, false) is false
      )
    into
      question_total,
      initial_correct,
      retry_correct,
      unresolved_wrong
    from public.quiz_questions
    where attempt_id = p_attempt_id;

    initial_score_value := round(
      (initial_correct::numeric / question_total) * 100,
      2
    );
    final_score_value := round(
      ((initial_correct + retry_correct)::numeric / question_total) * 100,
      2
    );
    evaluation_time := clock_timestamp();
    elapsed_seconds_value := case
      when p_phase = 'retry'
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
              epoch from (evaluation_time - attempt_row.retry_started_at)
            )
          )::integer
        )
      else greatest(
        0,
        floor(
          extract(epoch from (evaluation_time - attempt_row.started_at))
        )::integer
      )
    end;

    update public.quiz_attempts
    set status = 'completed',
        phase = 'completed',
        initial_completed_at = coalesce(
          initial_completed_at,
          evaluation_time
        ),
        completed_at = evaluation_time,
        initial_correct_count = initial_correct,
        retry_correct_count = retry_correct,
        unresolved_wrong_count = unresolved_wrong,
        initial_score = initial_score_value,
        final_score = final_score_value,
        passed = case
          when passing_basis_snapshot = 'initial'
            then initial_score_value >= passing_score_snapshot
          else final_score_value >= passing_score_snapshot
        end,
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
      evaluation_time,
      null,
      p_attempt_id,
      evaluation_time
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
      evaluation_time,
      p_attempt_id,
      evaluation_time
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
  elsif initial_unanswered > 0 then
    next_phase := 'initial';
    select id
    into next_question_id
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_choice_index is null
    order by order_index
    limit 1;
  elsif review_required then
    evaluation_time := clock_timestamp();
    initial_correct := question_total - initial_wrong;
    initial_score_value := round(
      (initial_correct::numeric / question_total) * 100,
      2
    );
    elapsed_seconds_value := greatest(
      0,
      floor(
        extract(epoch from (evaluation_time - attempt_row.started_at))
      )::integer
    );

    update public.quiz_attempts
    set phase = 'review',
        deadline_at = 'infinity'::timestamptz,
        initial_completed_at = coalesce(
          initial_completed_at,
          evaluation_time
        ),
        initial_correct_count = initial_correct,
        retry_correct_count = 0,
        unresolved_wrong_count = initial_wrong,
        initial_score = initial_score_value,
        elapsed_seconds = elapsed_seconds_value
    where id = p_attempt_id;
  else
    elapsed_seconds_value :=
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
              clock_timestamp() - attempt_row.retry_started_at
            )
          )
        )::integer
      );

    update public.quiz_attempts
    set retry_correct_count = retry_correct,
        unresolved_wrong_count = initial_wrong - retry_correct,
        elapsed_seconds = elapsed_seconds_value
    where id = p_attempt_id;

    next_phase := 'retry';
    select id
    into next_question_id
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and retry_choice_index is null
    order by order_index
    limit 1;
  end if;

  return jsonb_build_object(
    'correct', answer_correct,
    'correctChoiceIndex', question_row.correct_choice_index,
    'completed', completed_now,
    'expired', false,
    'needsRetry', review_required,
    'nextQuestionId', next_question_id,
    'nextPhase', next_phase,
    'initialAnsweredCount', question_total - initial_unanswered,
    'initialQuestionCount', question_total,
    'retryAnsweredCount', initial_wrong - retry_unanswered,
    'retryQuestionCount', initial_wrong
  );
end;
$$;

create function public.start_quiz_retry(
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
  initial_unanswered integer;
  initial_wrong integer;
  retry_unanswered integer;
  next_question_id uuid;
  retry_start_time timestamptz;
  retry_deadline timestamptz;
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

  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;

  if attempt_row.phase = 'retry' then
    if attempt_row.deadline_at <= now() then
      raise exception 'attempt_expired' using errcode = '22023';
    end if;

    select id
      into next_question_id
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and retry_choice_index is null
    order by order_index
    limit 1;

    return jsonb_build_object(
      'phase', 'retry',
      'nextQuestionId', next_question_id,
      'deadlineAt', attempt_row.deadline_at
    );
  end if;

  if attempt_row.phase <> 'review' then
    raise exception 'attempt_not_in_review' using errcode = '22023';
  end if;

  select
    count(*) filter (where initial_choice_index is null),
    count(*) filter (where initial_is_correct is false),
    count(*) filter (
      where initial_is_correct is false
        and retry_choice_index is null
    )
  into
    initial_unanswered,
    initial_wrong,
    retry_unanswered
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  if initial_unanswered > 0 then
    raise exception 'initial_phase_incomplete' using errcode = '22023';
  end if;

  if initial_wrong = 0 or retry_unanswered = 0 then
    raise exception 'retry_not_required' using errcode = '22023';
  end if;

  select id
    into next_question_id
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and initial_is_correct is false
    and retry_choice_index is null
  order by order_index
  limit 1;

  retry_start_time := clock_timestamp();
  retry_deadline := retry_start_time
    + make_interval(secs => attempt_row.time_limit_seconds_snapshot);

  update public.quiz_attempts
  set phase = 'retry',
      retry_started_at = retry_start_time,
      deadline_at = retry_deadline
  where id = p_attempt_id;

  return jsonb_build_object(
    'phase', 'retry',
    'nextQuestionId', next_question_id,
    'deadlineAt', retry_deadline
  );
end;
$$;

revoke all on function private.finalize_expired_quiz_attempt(
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function private.finalize_expired_quiz_attempt(
  uuid,
  uuid
) to service_role;

revoke all on function public.answer_quiz_question(
  uuid,
  uuid,
  uuid,
  text,
  smallint
) from public, anon, authenticated;
grant execute on function public.answer_quiz_question(
  uuid,
  uuid,
  uuid,
  text,
  smallint
) to service_role;

revoke all on function public.start_quiz_retry(
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.start_quiz_retry(
  uuid,
  uuid
) to service_role;

notify pgrst, 'reload schema';
