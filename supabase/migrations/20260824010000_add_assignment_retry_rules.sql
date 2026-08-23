begin;

alter table public.assignments
  add column retry_enabled boolean not null default true,
  add column retry_passing_score smallint;

-- Deleted assignments are immutable to application writes, but schema
-- backfills must initialize the new columns on every historical row.
alter table public.assignments
  disable trigger assignments_prevent_deleted_reactivation;
alter table public.assignments
  disable trigger assignments_set_updated_at;

update public.assignments
set retry_passing_score = passing_score
where retry_enabled
  and retry_passing_score is null;

alter table public.assignments
  enable trigger assignments_set_updated_at;
alter table public.assignments
  enable trigger assignments_prevent_deleted_reactivation;

alter table public.assignments
  add constraint assignments_retry_passing_score_check check (
    retry_passing_score is null
    or retry_passing_score between 0 and 100
  ),
  add constraint assignments_retry_settings_check check (
    (retry_enabled and retry_passing_score is not null)
    or (not retry_enabled and retry_passing_score is null)
  );

alter table public.quiz_attempts
  add column retry_enabled_snapshot boolean not null default true,
  add column retry_passing_score_snapshot smallint;

update public.quiz_attempts as attempt
set retry_enabled_snapshot = assignment.retry_enabled,
    retry_passing_score_snapshot = assignment.retry_passing_score
from public.assignments as assignment
where assignment.id = attempt.assignment_id;

alter table public.quiz_attempts
  add constraint quiz_attempts_retry_passing_score_snapshot_check check (
    retry_passing_score_snapshot is null
    or retry_passing_score_snapshot between 0 and 100
  ),
  add constraint quiz_attempts_retry_settings_snapshot_check check (
    (retry_enabled_snapshot and retry_passing_score_snapshot is not null)
    or (
      not retry_enabled_snapshot
      and retry_passing_score_snapshot is null
    )
  );

create function private.default_assignment_retry_settings_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.retry_enabled then
    new.retry_passing_score := coalesce(
      new.retry_passing_score,
      new.passing_score
    );
  else
    new.retry_passing_score := null;
  end if;
  return new;
end;
$$;

create trigger assignments_default_retry_settings
before insert on public.assignments
for each row
execute function private.default_assignment_retry_settings_v1();

create function private.snapshot_assignment_retry_settings_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select
    assignment.retry_enabled,
    assignment.retry_passing_score
  into
    new.retry_enabled_snapshot,
    new.retry_passing_score_snapshot
  from public.assignments as assignment
  where assignment.id = new.assignment_id;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger quiz_attempts_snapshot_retry_settings
before insert on public.quiz_attempts
for each row
execute function private.snapshot_assignment_retry_settings_v1();

create function private.configure_assignment_retry_v1(
  p_assignment_id uuid,
  p_retry_enabled boolean,
  p_retry_passing_score smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_assignment_id is null
    or p_retry_enabled is null
    or (
      p_retry_enabled
      and p_retry_passing_score is null
    )
    or (
      not p_retry_enabled
      and p_retry_passing_score is not null
    )
    or (
      p_retry_passing_score is not null
      and p_retry_passing_score not between 0 and 100
    )
  then
    raise exception 'invalid_assignment_retry_settings'
      using errcode = '22023';
  end if;

  update public.assignments
  set retry_enabled = p_retry_enabled,
      retry_passing_score = p_retry_passing_score
  where id = p_assignment_id;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.create_assignment_with_delivery_v7(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
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
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  created_assignment_id := private.create_assignment_with_delivery_v6(
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
  perform private.configure_assignment_retry_v1(
    created_assignment_id,
    p_retry_enabled,
    p_retry_passing_score
  );
  return created_assignment_id;
end;
$$;

create function public.create_mixed_review_assignment_v10(
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
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
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
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  created_assignment_id := private.create_mixed_review_assignment_v9(
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
  perform private.configure_assignment_retry_v1(
    created_assignment_id,
    p_retry_enabled,
    p_retry_passing_score
  );
  return created_assignment_id;
end;
$$;

create function public.create_exact_review_assignment_v7(
  p_student_id uuid,
  p_dataset_id uuid,
  p_selected_queue_ids uuid[],
  p_title text,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
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
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  created_assignment_id := private.create_exact_review_assignment_v5(
    p_student_id,
    p_dataset_id,
    p_selected_queue_ids,
    p_title,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
  perform private.configure_assignment_retry_v1(
    created_assignment_id,
    p_retry_enabled,
    p_retry_passing_score
  );
  return created_assignment_id;
end;
$$;

create function public.replace_student_assignment_v5(
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
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
  replacement_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  result_value := private.replace_student_assignment_v4(
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

  replacement_assignment_id :=
    (result_value ->> 'replacementAssignmentId')::uuid;
  perform private.configure_assignment_retry_v1(
    replacement_assignment_id,
    p_retry_enabled,
    p_retry_passing_score
  );
  return result_value;
end;
$$;

create function public.create_bulk_vocab_assignments_v9(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
  result_item jsonb;
  batch_item jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  result_value := public.create_bulk_vocab_assignments_v8(
    p_idempotency_key,
    p_request_sha256,
    p_batches
  );

  for result_item in
    select value
    from jsonb_array_elements(result_value)
  loop
    select batch.value
    into batch_item
    from jsonb_array_elements(p_batches) as batch(value)
    where batch.value ->> 'student_id' = result_item ->> 'student_id'
      and batch.value ->> 'session_number' =
        result_item ->> 'session_number';

    if batch_item is null
      or jsonb_typeof(batch_item -> 'retry_enabled') <> 'boolean'
      or not (batch_item ? 'retry_passing_score')
    then
      raise exception 'invalid_assignment_retry_settings'
        using errcode = '22023';
    end if;

    perform private.configure_assignment_retry_v1(
      (result_item ->> 'assignment_id')::uuid,
      (batch_item ->> 'retry_enabled')::boolean,
      nullif(batch_item ->> 'retry_passing_score', '')::smallint
    );
  end loop;

  return result_value;
end;
$$;

create function private.configure_vocab_queue_item_retry_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_enabled_value boolean;
  retry_passing_score_value smallint;
begin
  if new.assignment_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and old.assignment_id is not distinct from new.assignment_id
  then
    return new;
  end if;

  retry_enabled_value := coalesce(
    nullif(new.payload ->> 'retry_enabled', '')::boolean,
    true
  );
  retry_passing_score_value := case
    when retry_enabled_value then coalesce(
      nullif(new.payload ->> 'retry_passing_score', '')::smallint,
      nullif(new.payload ->> 'passing_score', '')::smallint
    )
    else null
  end;

  perform private.configure_assignment_retry_v1(
    new.assignment_id,
    retry_enabled_value,
    retry_passing_score_value
  );
  return new;
end;
$$;

create trigger vocab_assignment_series_items_configure_retry
after insert or update of assignment_id
on private.vocab_assignment_series_items
for each row
execute function private.configure_vocab_queue_item_retry_v1();

create function public.create_vocab_assignment_queues_v2(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_series jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.create_vocab_assignment_queues_v1(
    p_idempotency_key,
    p_request_sha256,
    p_series
  );
end;
$$;

create function private.complete_quiz_after_initial_v1(
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  question_total integer;
  initial_correct integer;
  initial_score_value numeric(5,2);
  evaluation_time timestamptz;
  elapsed_seconds_value integer;
begin
  select attempt.*
  into attempt_row
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if attempt_row.status <> 'in_progress'
    or attempt_row.phase <> 'review'
  then
    raise exception 'attempt_not_in_review' using errcode = '22023';
  end if;

  select
    count(*),
    count(*) filter (where initial_is_correct is true)
  into question_total, initial_correct
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  if question_total < 1
    or exists (
      select 1
      from public.quiz_questions
      where attempt_id = p_attempt_id
        and initial_is_correct is null
    )
  then
    raise exception 'initial_phase_incomplete' using errcode = '22023';
  end if;

  initial_score_value := round(
    (initial_correct::numeric / question_total) * 100,
    2
  );
  evaluation_time := clock_timestamp();
  elapsed_seconds_value := greatest(
    0,
    floor(
      extract(epoch from (evaluation_time - attempt_row.started_at))
    )::integer
  );

  update public.quiz_attempts
  set status = 'completed',
      phase = 'completed',
      initial_completed_at = coalesce(initial_completed_at, evaluation_time),
      completed_at = evaluation_time,
      initial_correct_count = initial_correct,
      retry_correct_count = 0,
      unresolved_wrong_count = question_total - initial_correct,
      initial_score = initial_score_value,
      final_score = initial_score_value,
      passed = initial_score_value >= passing_score_snapshot,
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
    and initial_is_correct is true
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
    'initialScore', initial_score_value,
    'finalScore', initial_score_value,
    'passed', initial_score_value >= attempt_row.passing_score_snapshot
  );
end;
$$;

create function public.answer_quiz_question_v4(
  p_student_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_phase text,
  p_choice_index smallint,
  p_force_timeout boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
  attempt_row public.quiz_attempts%rowtype;
  completion_value jsonb;
  retry_passed_value boolean;
begin
  result_value := public.answer_quiz_question_v3(
    p_student_id,
    p_attempt_id,
    p_question_id,
    p_phase,
    p_choice_index,
    p_force_timeout
  );

  select attempt.*
  into attempt_row
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  if p_phase = 'initial'
    and coalesce((result_value ->> 'needsRetry')::boolean, false)
    and (
      not attempt_row.retry_enabled_snapshot
      or attempt_row.initial_score >= attempt_row.passing_score_snapshot
    )
  then
    completion_value := private.complete_quiz_after_initial_v1(
      p_student_id,
      p_attempt_id
    );
    result_value := result_value || completion_value || jsonb_build_object(
      'needsRetry', false,
      'nextQuestionId', null,
      'nextPhase', null
    );
  elsif p_phase = 'retry'
    and coalesce((result_value ->> 'completed')::boolean, false)
  then
    update public.quiz_attempts
    set passed = final_score >= retry_passing_score_snapshot
    where id = p_attempt_id
    returning passed into retry_passed_value;
    result_value := result_value || jsonb_build_object(
      'passed', retry_passed_value
    );
  end if;

  return result_value;
end;
$$;

create function public.start_quiz_retry_v2(
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry_enabled_value boolean;
begin
  select attempt.retry_enabled_snapshot
  into retry_enabled_value
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if not retry_enabled_value then
    raise exception 'retry_disabled' using errcode = '22023';
  end if;

  return public.start_quiz_retry(p_student_id, p_attempt_id);
end;
$$;

revoke all on function private.default_assignment_retry_settings_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.snapshot_assignment_retry_settings_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.configure_assignment_retry_v1(
  uuid, boolean, smallint
) from public, anon, authenticated, service_role;
revoke all on function private.configure_vocab_queue_item_retry_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.complete_quiz_after_initial_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_assignment_with_delivery_v7(
  text, uuid, uuid[], integer, smallint, integer, smallint, boolean,
  smallint, public.question_order_mode, timestamptz, uuid[], text, integer,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_assignment_with_delivery_v7(
  text, uuid, uuid[], integer, smallint, integer, smallint, boolean,
  smallint, public.question_order_mode, timestamptz, uuid[], text, integer,
  jsonb
) to authenticated, service_role;

revoke all on function public.create_mixed_review_assignment_v10(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, boolean, smallint, public.question_order_mode, timestamptz, text,
  integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_mixed_review_assignment_v10(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, boolean, smallint, public.question_order_mode, timestamptz, text,
  integer, jsonb
) to authenticated, service_role;

revoke all on function public.create_exact_review_assignment_v7(
  uuid, uuid, uuid[], text, smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_exact_review_assignment_v7(
  uuid, uuid, uuid[], text, smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

revoke all on function public.replace_student_assignment_v5(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, boolean, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_student_assignment_v5(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, boolean, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) to authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v9(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v9(
  uuid, text, jsonb
) to authenticated, service_role;

revoke all on function public.create_vocab_assignment_queues_v2(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_vocab_assignment_queues_v2(
  uuid, text, jsonb
) to authenticated, service_role;

revoke all on function public.answer_quiz_question_v4(
  uuid, uuid, uuid, text, smallint, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.answer_quiz_question_v4(
  uuid, uuid, uuid, text, smallint, boolean
) to service_role;

revoke all on function public.start_quiz_retry_v2(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.start_quiz_retry_v2(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
