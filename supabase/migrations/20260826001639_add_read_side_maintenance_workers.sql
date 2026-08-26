begin;

create function private.save_student_app_maintenance_state_v1(
  p_job_name text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_processed_count integer,
  p_failed_count integer,
  p_attention_count integer,
  p_pending_count integer,
  p_pending_count_is_lower_bound boolean,
  p_oldest_due_at timestamptz,
  p_last_error_code text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_job_name not in (
    'english-academy-finalize-stale-attempts',
    'english-academy-expire-review-drafts',
    'english-academy-materialize-ready-vocab-queues'
  )
    or p_started_at is null
    or p_completed_at is null
    or p_completed_at < p_started_at
    or p_processed_count is null
    or p_processed_count < 0
    or p_failed_count is null
    or p_failed_count < 0
    or p_attention_count is null
    or p_attention_count < 0
    or p_pending_count is null
    or p_pending_count < 0
    or p_pending_count_is_lower_bound is null
    or (
      p_last_error_code is not null
      and p_last_error_code not in (
        'concurrency',
        'invalid_data',
        'data_conflict',
        'missing_data',
        'permission',
        'database_error',
        'retryable_materialization',
        'queue_attention_required',
        'maintenance_attention_required'
      )
    )
  then
    raise exception 'invalid_student_app_maintenance_state'
      using errcode = '22023';
  end if;

  insert into private.student_app_maintenance_state as state (
    job_name,
    last_started_at,
    last_completed_at,
    last_clean_at,
    processed_count,
    failed_count,
    attention_count,
    pending_count,
    pending_count_is_lower_bound,
    oldest_due_at,
    consecutive_failed_runs,
    last_error_code,
    updated_at
  ) values (
    p_job_name,
    p_started_at,
    p_completed_at,
    case
      when p_failed_count = 0 and p_attention_count = 0
      then p_completed_at
      else null
    end,
    p_processed_count,
    p_failed_count,
    p_attention_count,
    p_pending_count,
    p_pending_count_is_lower_bound,
    p_oldest_due_at,
    case when p_failed_count > 0 then 1 else 0 end,
    p_last_error_code,
    p_completed_at
  )
  on conflict (job_name)
  do update set
    last_started_at = excluded.last_started_at,
    last_completed_at = excluded.last_completed_at,
    last_clean_at = case
      when excluded.failed_count = 0 and excluded.attention_count = 0
      then excluded.last_completed_at
      else state.last_clean_at
    end,
    processed_count = excluded.processed_count,
    failed_count = excluded.failed_count,
    attention_count = excluded.attention_count,
    pending_count = excluded.pending_count,
    pending_count_is_lower_bound = excluded.pending_count_is_lower_bound,
    oldest_due_at = excluded.oldest_due_at,
    consecutive_failed_runs = case
      when excluded.failed_count > 0
      then state.consecutive_failed_runs + 1
      when excluded.attention_count > 0
      then state.consecutive_failed_runs
      else 0
    end,
    last_error_code = case
      when excluded.last_error_code is not null
      then excluded.last_error_code
      when excluded.attention_count > 0
      then state.last_error_code
      else null
    end,
    updated_at = excluded.updated_at;
end;
$$;

create function private.run_stale_quiz_attempt_maintenance_v1(
  p_student_limit integer default 10,
  p_attempt_limit integer default 25,
  p_backlog_probe_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '30s'
as $$
declare
  job_name_value constant text :=
    'english-academy-finalize-stale-attempts';
  evaluation_at_value timestamptz := transaction_timestamp();
  completed_at_value timestamptz;
  candidate_student record;
  candidate_attempt record;
  work_count integer := 0;
  processed_count_value integer := 0;
  failed_count_value integer := 0;
  attention_count_value integer := 0;
  sampled_pending_count integer := 0;
  pending_count_value integer := 0;
  pending_count_is_lower_bound_value boolean := false;
  oldest_due_at_value timestamptz;
  error_sqlstate_value text;
  error_code_value text;
begin
  if p_student_limit is null or p_student_limit not between 1 and 50
    or p_attempt_limit is null or p_attempt_limit not between 1 and 250
    or p_backlog_probe_limit is null
    or p_backlog_probe_limit not between 1 and 5000
  then
    raise exception 'invalid_stale_attempt_maintenance_limit'
      using errcode = '22023';
  end if;

  for candidate_student in
    select student.id, due.oldest_due_at
    from public.students as student
    cross join lateral (
      select attempt.deadline_at as oldest_due_at
      from public.quiz_attempts as attempt
      where attempt.student_id = student.id
        and attempt.status = 'in_progress'
        and attempt.phase in ('initial', 'retry')
        and attempt.deadline_at <= evaluation_at_value
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'quiz_attempt'
            and retry.target_id = attempt.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by attempt.deadline_at, attempt.id
      limit 1
    ) as due
    order by due.oldest_due_at, student.id
    for update of student skip locked
    limit p_student_limit
  loop
    exit when work_count >= p_attempt_limit;
    for candidate_attempt in
      select attempt.id
      from public.quiz_attempts as attempt
      where attempt.student_id = candidate_student.id
        and attempt.status = 'in_progress'
        and attempt.phase in ('initial', 'retry')
        and attempt.deadline_at <= evaluation_at_value
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'quiz_attempt'
            and retry.target_id = attempt.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by attempt.deadline_at, attempt.id
      for update skip locked
      limit (p_attempt_limit - work_count)
    loop
      work_count := work_count + 1;
      begin
        perform private.finalize_expired_quiz_attempt_at_v2(
          candidate_student.id,
          candidate_attempt.id,
          evaluation_at_value
        );
        processed_count_value := processed_count_value + 1;
        perform private.clear_student_app_maintenance_failure_v1(
          job_name_value,
          candidate_attempt.id
        );
      exception when others then
        get stacked diagnostics error_sqlstate_value = returned_sqlstate;
        error_code_value :=
          private.classify_student_app_maintenance_error_v1(
            error_sqlstate_value
          );
        perform private.record_student_app_maintenance_failure_v1(
          job_name_value,
          'quiz_attempt',
          candidate_attempt.id,
          candidate_student.id,
          error_code_value,
          evaluation_at_value
        );
        failed_count_value := failed_count_value + 1;
      end;
    end loop;
  end loop;

  delete from private.student_app_maintenance_retry_state as retry
  where retry.job_name = job_name_value
    and retry.target_kind = 'quiz_attempt'
    and not exists (
      select 1
      from public.quiz_attempts as attempt
      where attempt.id = retry.target_id
        and attempt.student_id = retry.student_id
        and attempt.status = 'in_progress'
        and attempt.phase in ('initial', 'retry')
        and attempt.deadline_at <= evaluation_at_value
    );

  select count(*)::integer, min(sample.deadline_at)
  into sampled_pending_count, oldest_due_at_value
  from (
    select attempt.deadline_at
    from public.quiz_attempts as attempt
    where attempt.status = 'in_progress'
      and attempt.phase in ('initial', 'retry')
      and attempt.deadline_at <= evaluation_at_value
    order by attempt.deadline_at, attempt.id
    limit (p_backlog_probe_limit + 1)
  ) as sample;
  pending_count_is_lower_bound_value :=
    sampled_pending_count > p_backlog_probe_limit;
  pending_count_value := least(
    sampled_pending_count,
    p_backlog_probe_limit
  );
  select count(*)::integer
  into attention_count_value
  from private.student_app_maintenance_retry_state as retry
  where retry.job_name = job_name_value
    and retry.requires_attention;
  if failed_count_value = 0 and attention_count_value > 0 then
    error_code_value := 'maintenance_attention_required';
  end if;

  completed_at_value := clock_timestamp();
  perform private.save_student_app_maintenance_state_v1(
    job_name_value,
    evaluation_at_value,
    completed_at_value,
    processed_count_value,
    failed_count_value,
    attention_count_value,
    pending_count_value,
    pending_count_is_lower_bound_value,
    oldest_due_at_value,
    error_code_value
  );

  return jsonb_build_object(
    'jobName', job_name_value,
    'processedCount', processed_count_value,
    'failedCount', failed_count_value,
    'attentionCount', attention_count_value,
    'pendingCount', pending_count_value,
    'pendingCountIsLowerBound', pending_count_is_lower_bound_value,
    'oldestDueAt', oldest_due_at_value
  );
end;
$$;

create function private.run_expired_review_draft_maintenance_v1(
  p_student_limit integer default 10,
  p_draft_limit integer default 50,
  p_per_student_limit integer default 10,
  p_backlog_probe_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '30s'
as $$
declare
  job_name_value constant text :=
    'english-academy-expire-review-drafts';
  evaluation_at_value timestamptz := transaction_timestamp();
  completed_at_value timestamptz;
  candidate_student record;
  candidate_draft record;
  draft_finalized boolean;
  work_count integer := 0;
  processed_count_value integer := 0;
  failed_count_value integer := 0;
  attention_count_value integer := 0;
  sampled_pending_count integer := 0;
  pending_count_value integer := 0;
  pending_count_is_lower_bound_value boolean := false;
  oldest_due_at_value timestamptz;
  error_sqlstate_value text;
  error_code_value text;
begin
  if p_student_limit is null or p_student_limit not between 1 and 50
    or p_draft_limit is null or p_draft_limit not between 1 and 250
    or p_per_student_limit is null
    or p_per_student_limit not between 1 and 50
    or p_backlog_probe_limit is null
    or p_backlog_probe_limit not between 1 and 5000
  then
    raise exception 'invalid_review_draft_maintenance_limit'
      using errcode = '22023';
  end if;

  for candidate_student in
    select student.id, due.oldest_due_at
    from public.students as student
    cross join lateral (
      select draft.expires_at as oldest_due_at
      from public.student_vocab_review_assignment_drafts as draft
      where draft.student_id = student.id
        and draft.status = 'pending'
        and draft.expires_at <= evaluation_at_value
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'review_draft'
            and retry.target_id = draft.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by draft.expires_at, draft.id
      limit 1
    ) as due
    order by due.oldest_due_at, student.id
    for update of student skip locked
    limit p_student_limit
  loop
    exit when work_count >= p_draft_limit;
    for candidate_draft in
      select draft.id
      from public.student_vocab_review_assignment_drafts as draft
      where draft.student_id = candidate_student.id
        and draft.status = 'pending'
        and draft.expires_at <= evaluation_at_value
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'review_draft'
            and retry.target_id = draft.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by draft.expires_at, draft.id
      for update skip locked
      limit least(
        p_per_student_limit,
        p_draft_limit - work_count
      )
    loop
      work_count := work_count + 1;
      begin
        draft_finalized :=
          private.finalize_expired_review_assignment_draft_at_v1(
            candidate_student.id,
            candidate_draft.id,
            evaluation_at_value
          );
        if draft_finalized then
          processed_count_value := processed_count_value + 1;
        end if;
        perform private.clear_student_app_maintenance_failure_v1(
          job_name_value,
          candidate_draft.id
        );
      exception when others then
        get stacked diagnostics error_sqlstate_value = returned_sqlstate;
        error_code_value :=
          private.classify_student_app_maintenance_error_v1(
            error_sqlstate_value
          );
        perform private.record_student_app_maintenance_failure_v1(
          job_name_value,
          'review_draft',
          candidate_draft.id,
          candidate_student.id,
          error_code_value,
          evaluation_at_value
        );
        failed_count_value := failed_count_value + 1;
      end;
    end loop;
  end loop;

  delete from private.student_app_maintenance_retry_state as retry
  where retry.job_name = job_name_value
    and retry.target_kind = 'review_draft'
    and not exists (
      select 1
      from public.student_vocab_review_assignment_drafts as draft
      where draft.id = retry.target_id
        and draft.student_id = retry.student_id
        and draft.status = 'pending'
        and draft.expires_at <= evaluation_at_value
    );

  select count(*)::integer, min(sample.expires_at)
  into sampled_pending_count, oldest_due_at_value
  from (
    select draft.expires_at
    from public.student_vocab_review_assignment_drafts as draft
    where draft.status = 'pending'
      and draft.expires_at <= evaluation_at_value
    order by draft.expires_at, draft.id
    limit (p_backlog_probe_limit + 1)
  ) as sample;
  pending_count_is_lower_bound_value :=
    sampled_pending_count > p_backlog_probe_limit;
  pending_count_value := least(
    sampled_pending_count,
    p_backlog_probe_limit
  );
  select count(*)::integer
  into attention_count_value
  from private.student_app_maintenance_retry_state as retry
  where retry.job_name = job_name_value
    and retry.requires_attention;
  if failed_count_value = 0 and attention_count_value > 0 then
    error_code_value := 'maintenance_attention_required';
  end if;

  completed_at_value := clock_timestamp();
  perform private.save_student_app_maintenance_state_v1(
    job_name_value,
    evaluation_at_value,
    completed_at_value,
    processed_count_value,
    failed_count_value,
    attention_count_value,
    pending_count_value,
    pending_count_is_lower_bound_value,
    oldest_due_at_value,
    error_code_value
  );

  return jsonb_build_object(
    'jobName', job_name_value,
    'processedCount', processed_count_value,
    'failedCount', failed_count_value,
    'attentionCount', attention_count_value,
    'pendingCount', pending_count_value,
    'pendingCountIsLowerBound', pending_count_is_lower_bound_value,
    'oldestDueAt', oldest_due_at_value
  );
end;
$$;

create function private.run_ready_vocab_queue_maintenance_v1(
  p_item_limit integer default 2,
  p_backlog_probe_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '30s'
as $$
declare
  job_name_value constant text :=
    'english-academy-materialize-ready-vocab-queues';
  evaluation_at_value timestamptz := transaction_timestamp();
  completed_at_value timestamptz;
  candidate_student record;
  candidate_item record;
  materialized_result jsonb;
  result_count integer;
  assigned_count integer;
  retry_count integer;
  result_attention_count integer;
  work_count integer := 0;
  processed_count_value integer := 0;
  failed_count_value integer := 0;
  attention_count_value integer := 0;
  sampled_pending_count integer := 0;
  pending_count_value integer := 0;
  pending_count_is_lower_bound_value boolean := false;
  oldest_due_at_value timestamptz;
  error_sqlstate_value text;
  error_code_value text;
begin
  if p_item_limit is null or p_item_limit not between 1 and 10
    or p_backlog_probe_limit is null
    or p_backlog_probe_limit not between 1 and 5000
  then
    raise exception 'invalid_vocab_queue_maintenance_limit'
      using errcode = '22023';
  end if;

  for candidate_student in
    select student.id, due.oldest_due_at
    from public.students as student
    cross join lateral (
      select ready_item.effective_available_from as oldest_due_at
      from private.vocab_assignment_series as series
      cross join lateral (
        select item.id, item.effective_available_from
        from private.vocab_assignment_series_items as item
        where item.series_id = series.id
          and item.status = 'ready'
        order by item.sequence_number, item.id
        limit 1
      ) as ready_item
      where series.student_id = student.id
        and series.status = 'active'
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'vocab_series_item'
            and retry.target_id = ready_item.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by ready_item.effective_available_from, ready_item.id
      limit 1
    ) as due
    where student.status = 'active'
      and student.deleted_at is null
    order by due.oldest_due_at, student.id
    for update of student skip locked
    limit p_item_limit
  loop
    exit when work_count >= p_item_limit;
    for candidate_item in
      select item.id
      from private.vocab_assignment_series as series
      join private.vocab_assignment_series_items as item
        on item.series_id = series.id
      where series.student_id = candidate_student.id
        and series.status = 'active'
        and item.status = 'ready'
        and not exists (
          select 1
          from private.vocab_assignment_series_items as earlier
          where earlier.series_id = item.series_id
            and earlier.status = 'ready'
            and (
              earlier.sequence_number < item.sequence_number
              or (
                earlier.sequence_number = item.sequence_number
                and earlier.id < item.id
              )
            )
        )
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'vocab_series_item'
            and retry.target_id = item.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by item.effective_available_from, item.id
      for update of item skip locked
      limit (p_item_limit - work_count)
    loop
      work_count := work_count + 1;
      begin
        materialized_result :=
          private.materialize_ready_vocab_assignment_queue_v2(
            candidate_student.id,
            1,
            evaluation_at_value,
            candidate_item.id
          );
        result_count := jsonb_array_length(materialized_result);
        select
          count(*) filter (
            where result.item ->> 'status' = 'assigned'
          )::integer,
          count(*) filter (
            where result.item ->> 'status' = 'ready'
          )::integer,
          count(*) filter (
            where result.item ->> 'status' = 'attention'
          )::integer
        into assigned_count, retry_count, result_attention_count
        from jsonb_array_elements(materialized_result) as result(item);

        if result_count < 0
          or assigned_count + retry_count + result_attention_count
            <> result_count
        then
          raise exception 'invalid_vocab_queue_materialize_result'
            using errcode = '22023';
        end if;

        processed_count_value := processed_count_value
          + assigned_count
          + result_attention_count;
        failed_count_value := failed_count_value + retry_count;

        if retry_count > 0 then
          error_code_value := 'retryable_materialization';
          perform private.record_student_app_maintenance_failure_v1(
            job_name_value,
            'vocab_series_item',
            candidate_item.id,
            candidate_student.id,
            error_code_value,
            evaluation_at_value
          );
        else
          perform private.clear_student_app_maintenance_failure_v1(
            job_name_value,
            candidate_item.id
          );
        end if;
        if result_attention_count > 0 then
          error_code_value := 'queue_attention_required';
        end if;
      exception when others then
        get stacked diagnostics error_sqlstate_value = returned_sqlstate;
        error_code_value :=
          private.classify_student_app_maintenance_error_v1(
            error_sqlstate_value
          );
        perform private.record_student_app_maintenance_failure_v1(
          job_name_value,
          'vocab_series_item',
          candidate_item.id,
          candidate_student.id,
          error_code_value,
          evaluation_at_value
        );
        failed_count_value := failed_count_value + 1;
      end;
    end loop;
  end loop;

  delete from private.student_app_maintenance_retry_state as retry
  where retry.job_name = job_name_value
    and retry.target_kind = 'vocab_series_item'
    and not exists (
      select 1
      from private.vocab_assignment_series as series
      join private.vocab_assignment_series_items as item
        on item.series_id = series.id
      join public.students as student
        on student.id = series.student_id
      where item.id = retry.target_id
        and series.student_id = retry.student_id
        and series.status = 'active'
        and item.status = 'ready'
        and student.status = 'active'
        and student.deleted_at is null
    );

  select count(*)::integer, min(sample.effective_available_from)
  into sampled_pending_count, oldest_due_at_value
  from (
    select item.effective_available_from
    from private.vocab_assignment_series_items as item
    join private.vocab_assignment_series as series
      on series.id = item.series_id
    join public.students as student
      on student.id = series.student_id
    where item.status = 'ready'
      and series.status = 'active'
      and student.status = 'active'
      and student.deleted_at is null
    order by item.effective_available_from, item.id
    limit (p_backlog_probe_limit + 1)
  ) as sample;
  pending_count_is_lower_bound_value :=
    sampled_pending_count > p_backlog_probe_limit;
  pending_count_value := least(
    sampled_pending_count,
    p_backlog_probe_limit
  );

  select count(*)::integer
  into attention_count_value
  from (
    select retry.target_kind, retry.target_id
    from private.student_app_maintenance_retry_state as retry
    where retry.job_name = job_name_value
      and retry.target_kind = 'vocab_series_item'
      and retry.requires_attention
    union
    select 'vocab_series_item'::text, item.id
    from private.vocab_assignment_series as series
    join private.vocab_assignment_series_items as item
      on item.series_id = series.id
    where series.status = 'attention'
      and item.status = 'attention'
  ) as attention_targets;
  if failed_count_value = 0 and attention_count_value > 0 then
    error_code_value := 'queue_attention_required';
  end if;

  completed_at_value := clock_timestamp();
  perform private.save_student_app_maintenance_state_v1(
    job_name_value,
    evaluation_at_value,
    completed_at_value,
    processed_count_value,
    failed_count_value,
    attention_count_value,
    pending_count_value,
    pending_count_is_lower_bound_value,
    oldest_due_at_value,
    error_code_value
  );

  return jsonb_build_object(
    'jobName', job_name_value,
    'processedCount', processed_count_value,
    'failedCount', failed_count_value,
    'attentionCount', attention_count_value,
    'pendingCount', pending_count_value,
    'pendingCountIsLowerBound', pending_count_is_lower_bound_value,
    'oldestDueAt', oldest_due_at_value
  );
end;
$$;

-- Keep the transition period safe while existing server reads still call the
-- legacy public recovery entry points. Every public definer verifies the
-- service caller again inside the function.
create or replace function public.finalize_stale_quiz_attempts(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_finalize_limit' using errcode = '22023';
  end if;

  result := private.run_stale_quiz_attempt_maintenance_v1(
    least(p_limit, 50),
    least(p_limit, 250),
    1000
  );
  return (result ->> 'processedCount')::integer;
end;
$$;

create or replace function public.finalize_quiz_attempt_if_stale(
  p_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  evaluation_at_value timestamptz := transaction_timestamp();
  student_id_value uuid;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_attempt_id is null then
    raise exception 'invalid_attempt_id' using errcode = '22023';
  end if;

  select attempt.student_id
  into student_id_value
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id;
  if not found then
    return false;
  end if;

  perform 1
  from public.students as student
  where student.id = student_id_value
  for update;
  if not found then
    return false;
  end if;

  perform 1
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = student_id_value
    and attempt.status = 'in_progress'
    and attempt.phase in ('initial', 'retry')
    and attempt.deadline_at <= evaluation_at_value
  for update;
  if not found then
    return false;
  end if;

  perform private.finalize_expired_quiz_attempt_at_v2(
    student_id_value,
    p_attempt_id,
    evaluation_at_value
  );
  return true;
end;
$$;

create or replace function public.finalize_expired_review_assignment_drafts(
  p_student_id uuid,
  p_limit integer default 400
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.finalize_expired_review_assignment_drafts_at_v2(
    p_student_id,
    p_limit,
    transaction_timestamp()
  );
end;
$$;

create or replace function public.materialize_ready_vocab_assignment_queue_v1(
  p_student_id uuid,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.materialize_ready_vocab_assignment_queue_v2(
    p_student_id,
    p_limit,
    transaction_timestamp()
  );
end;
$$;

create function public.get_student_app_maintenance_status_v1()
returns table (
  job_name text,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_clean_at timestamptz,
  processed_count integer,
  failed_count integer,
  attention_count integer,
  pending_count integer,
  pending_count_is_lower_bound boolean,
  oldest_due_at timestamptz,
  consecutive_failed_runs integer,
  last_error_code text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    state.job_name,
    state.last_started_at,
    state.last_completed_at,
    state.last_clean_at,
    state.processed_count,
    state.failed_count,
    state.attention_count,
    state.pending_count,
    state.pending_count_is_lower_bound,
    state.oldest_due_at,
    state.consecutive_failed_runs,
    state.last_error_code,
    state.updated_at
  from private.student_app_maintenance_state as state
  order by state.job_name;
end;
$$;

revoke all on function private.save_student_app_maintenance_state_v1(
  text, timestamptz, timestamptz, integer, integer, integer, integer,
  boolean, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function private.run_stale_quiz_attempt_maintenance_v1(
  integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.run_expired_review_draft_maintenance_v1(
  integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.run_ready_vocab_queue_maintenance_v1(
  integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.finalize_stale_quiz_attempts(integer)
  from public, anon, authenticated;
grant execute on function public.finalize_stale_quiz_attempts(integer)
  to service_role;
revoke all on function public.finalize_quiz_attempt_if_stale(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_quiz_attempt_if_stale(uuid)
  to service_role;
revoke all on function public.finalize_expired_review_assignment_drafts(
  uuid, integer
) from public, anon, authenticated;
grant execute on function public.finalize_expired_review_assignment_drafts(
  uuid, integer
) to service_role;
revoke all on function public.materialize_ready_vocab_assignment_queue_v1(
  uuid, integer
) from public, anon, authenticated;
grant execute on function public.materialize_ready_vocab_assignment_queue_v1(
  uuid, integer
) to service_role;

revoke all on function public.get_student_app_maintenance_status_v1()
  from public, anon, authenticated;
grant execute on function public.get_student_app_maintenance_status_v1()
  to service_role;

notify pgrst, 'reload schema';

commit;
