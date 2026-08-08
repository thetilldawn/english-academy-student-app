begin;

-- The original bulk creator predates the exam-use dictionary projection and
-- current-range review scope. Rebuild the selected snapshot with the same
-- scope and identity rules used by Preview, then persist through the
-- release-aware v5 assignment creator (which retains its legacy fallback).
create function private.create_mixed_review_assignment_v7(
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_release_id uuid;
  has_exam_use_release boolean;
  current_queue_ids uuid[];
  linked_queue_ids uuid[];
  created_assignment_id uuid;
  total_question_count integer;
  review_question_count integer;
  primary_unit_count integer;
  first_primary_sort integer;
  last_primary_sort integer;
  referenced_input_count integer;
  referenced_entry_count integer;
  first_referenced_sort integer;
  last_referenced_sort integer;
  first_scope_sort integer;
  last_scope_sort integer;
  scope_unit_ids uuid[];
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    ),
    (
      select release.release_id
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
        and release.status = 'active'
      limit 1
    )
  into has_exam_use_release, active_release_id;

  if has_exam_use_release and active_release_id is null then
    raise exception 'exam_use_release_inactive' using errcode = '55000';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_review_levels is null
    or p_review_scope is null
    or p_review_scope not in ('dataset', 'selection')
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
    or p_primary_unit_ids is null
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) not between 1 and 500
  then
    raise exception 'invalid_mixed_review_selection'
      using errcode = '22023';
  end if;

  total_question_count := jsonb_array_length(p_questions);
  review_question_count := cardinality(p_selected_queue_ids);
  if (
    cardinality(p_primary_unit_ids) = 0
    and total_question_count <> review_question_count
  ) or (
    cardinality(p_primary_unit_ids) > 0
    and (
      total_question_count not between 4 and 500
      or review_question_count >= total_question_count
      or cardinality(p_primary_unit_ids) <> (
        select count(distinct unit_id)
        from unnest(p_primary_unit_ids) as input(unit_id)
        where unit_id is not null
      )
    )
  ) then
    raise exception 'invalid_review_assignment_mode'
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

  -- Rebuild the same full pending snapshot used by v6. A bulk request may not
  -- silently omit a selected level or reuse a word already in active work.
  with identity_by_entry as materialized (
    select
      entry.id as vocab_entry_id,
      exam_occurrence.dictionary_id,
      min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id,
      lower(trim(replace(entry.headword_normalized, '*', '')))
        as headword_key
    from public.vocab_entries as entry
    left join public.vocab_entry_quiz_eligibility as eligibility
      on eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
    left join word_index.app_exam_use_occurrence as exam_occurrence
      on exam_occurrence.release_id = active_release_id
      and exam_occurrence.dataset_id = entry.dataset_id
      and exam_occurrence.vocab_entry_id = entry.id
      and exam_occurrence.include_in_exam
      and exam_occurrence.exam_use_status = 'reviewed_for_preview'
    where entry.dataset_id = p_dataset_id
    group by entry.id, entry.headword_normalized, exam_occurrence.dictionary_id
  ),
  active_words as materialized (
    select
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
    left join public.assignment_question_exam_use_snapshot as exam_snapshot
      on exam_snapshot.assignment_question_id = question.id
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
          'dictionary:' || identity.dictionary_id,
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
      and (
        p_review_scope = 'dataset'
        or exists (
          select 1
          from public.vocab_entries as scoped_entry
          where scoped_entry.id = queue.vocab_entry_id
            and scoped_entry.dataset_id = queue.dataset_id
            and scoped_entry.unit_id = any(p_primary_unit_ids)
        )
      )
      and (
        active_release_id is null
        or identity.dictionary_id is not null
      )
      and not exists (
        select 1
        from active_words as active
        where active.vocab_entry_id = queue.vocab_entry_id
          or (
            identity.dictionary_id is not null
            and identity.dictionary_id = active.dictionary_id
          )
          or (
            identity.canonical_lexeme_id is not null
            and identity.canonical_lexeme_id = active.canonical_lexeme_id
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
    select ranked.id, ranked.reason_level, ranked.queued_at
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

  if current_queue_ids is distinct from p_selected_queue_ids then
    raise exception 'mixed_review_queue_snapshot_changed'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) or (
    select
      count(*) <> total_question_count
      or count(distinct question.base_order_index) <> total_question_count
      or min(question.base_order_index) <> 1
      or max(question.base_order_index) <> total_question_count
      or count(distinct question.vocab_entry_id) <> total_question_count
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  ) then
    raise exception 'invalid_exam_use_review_question_plan'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(current_queue_ids) with ordinality
      as selected(queue_id, position)
    join public.student_vocab_review_queue as queue
      on queue.id = selected.queue_id
    left join jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
      on question.base_order_index =
        total_question_count - review_question_count + selected.position
      and question.vocab_entry_id = queue.vocab_entry_id
    where question.vocab_entry_id is null
  ) then
    raise exception 'review_target_order_mismatch'
      using errcode = '22023';
  end if;

  if cardinality(p_primary_unit_ids) > 0 then
    select count(*), min(unit.sort_index), max(unit.sort_index)
    into primary_unit_count, first_primary_sort, last_primary_sort
    from public.vocab_units as unit
    where unit.dataset_id = p_dataset_id
      and unit.id = any(p_primary_unit_ids);

    if primary_unit_count <> cardinality(p_primary_unit_ids)
      or primary_unit_count <> last_primary_sort - first_primary_sort + 1
    then
      raise exception 'mixed_primary_units_invalid'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(p_questions) as question(
        vocab_entry_id bigint,
        base_order_index integer,
        direction text,
        choice_vocab_entry_ids bigint[]
      )
      where not exists (
        select 1
        from public.student_vocab_review_queue as queue
        where queue.id = any(current_queue_ids)
          and queue.vocab_entry_id = question.vocab_entry_id
      )
      and not exists (
        select 1
        from public.vocab_entries as entry
        where entry.id = question.vocab_entry_id
          and entry.dataset_id = p_dataset_id
          and entry.unit_id = any(p_primary_unit_ids)
      )
    ) then
      raise exception 'mixed_regular_target_outside_primary_units'
        using errcode = '22023';
    end if;
  end if;

  -- A non-selected pending word must never be smuggled in as ordinary content.
  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(vocab_entry_id bigint)
    where not exists (
      select 1
      from public.student_vocab_review_queue as selected_queue
      where selected_queue.id = any(current_queue_ids)
        and selected_queue.vocab_entry_id = question.vocab_entry_id
    )
    and exists (
      select 1
      from public.student_vocab_review_queue as pending_queue
      where pending_queue.student_id = p_student_id
        and pending_queue.dataset_id = p_dataset_id
        and pending_queue.status = 'pending'
        and pending_queue.vocab_entry_id = question.vocab_entry_id
    )
  ) then
    raise exception 'mixed_regular_target_already_pending_review'
      using errcode = '22023';
  end if;

  with referenced_entry_ids as (
    select question.vocab_entry_id
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      choice_vocab_entry_ids bigint[]
    )
    union
    select selected_choice.vocab_entry_id
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      choice_vocab_entry_ids bigint[]
    )
    cross join lateral unnest(question.choice_vocab_entry_ids)
      as selected_choice(vocab_entry_id)
  )
  select
    count(*),
    count(entry.id),
    min(unit.sort_index),
    max(unit.sort_index)
  into
    referenced_input_count,
    referenced_entry_count,
    first_referenced_sort,
    last_referenced_sort
  from referenced_entry_ids as referenced
  left join public.vocab_entries as entry
    on entry.id = referenced.vocab_entry_id
    and entry.dataset_id = p_dataset_id
  left join public.vocab_units as unit
    on unit.id = entry.unit_id
    and unit.dataset_id = entry.dataset_id;

  if referenced_input_count <> referenced_entry_count
    or first_referenced_sort is null
    or last_referenced_sort is null
  then
    raise exception 'review_question_entry_dataset_mismatch'
      using errcode = '22023';
  end if;

  first_scope_sort := case
    when cardinality(p_primary_unit_ids) > 0
      then least(first_referenced_sort, first_primary_sort)
    else first_referenced_sort
  end;
  last_scope_sort := case
    when cardinality(p_primary_unit_ids) > 0
      then greatest(last_referenced_sort, last_primary_sort)
    else last_referenced_sort
  end;

  select array_agg(unit.id order by unit.sort_index)
  into scope_unit_ids
  from public.vocab_units as unit
  where unit.dataset_id = p_dataset_id
    and unit.sort_index between first_scope_sort and last_scope_sort;

  if scope_unit_ids is null
    or cardinality(scope_unit_ids) < 1
    or cardinality(scope_unit_ids)
      <> last_scope_sort - first_scope_sort + 1
  then
    raise exception 'review_question_support_scope_not_contiguous'
      using errcode = '22023';
  end if;

  created_assignment_id := private.create_assignment_with_delivery_v5(
    p_title,
    p_dataset_id,
    scope_unit_ids,
    total_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    array[p_student_id],
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
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

  if linked_queue_ids is distinct from current_queue_ids then
    raise exception 'assignment_review_target_insert_mismatch'
      using errcode = '21000';
  end if;

  update public.assignments
  set assignment_purpose = case
    when cardinality(p_primary_unit_ids) = 0 then 'review'
    else 'mixed'
  end
  where id = created_assignment_id;

  update public.assignment_units
  set is_primary = unit_id = any(p_primary_unit_ids)
  where assignment_id = created_assignment_id;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.mixed_review_v7_created',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'releaseId', active_release_id,
      'reviewLevels', to_jsonb(p_review_levels),
      'reviewScope', p_review_scope,
      'selectedQueueIds', to_jsonb(current_queue_ids),
      'timingMode', p_timing_mode
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_mixed_review_assignment_v7(
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
  select private.create_mixed_review_assignment_v7(
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

revoke all on function private.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon;
grant execute on function private.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

revoke all on function public.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon;
grant execute on function public.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

create function private.create_bulk_vocab_assignments_v2(
  p_batches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch jsonb;
  batch_kind text;
  batch_student_id uuid;
  created_assignment_id uuid;
  locked_student_count integer;
  results jsonb := '[]'::jsonb;
  student_ids uuid[];
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_batches is null
    or jsonb_typeof(p_batches) <> 'array'
    or jsonb_array_length(p_batches) not between 1 and 30
  then
    raise exception 'invalid_bulk_assignment_batches'
      using errcode = '22023';
  end if;

  select array_agg((item ->> 'student_id')::uuid order by item ->> 'student_id')
  into student_ids
  from jsonb_array_elements(p_batches) as input(item);

  if cardinality(student_ids) <> (
    select count(distinct student_id)
    from unnest(student_ids) as input(student_id)
    where student_id is not null
  ) then
    raise exception 'duplicate_bulk_assignment_student'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = any(student_ids)
    and student.status = 'active'
    and student.deleted_at is null
  order by student.id
  for update;

  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(student_ids)
    and student.status = 'active'
    and student.deleted_at is null;

  if locked_student_count <> cardinality(student_ids) then
    raise exception 'bulk_assignment_student_not_active'
      using errcode = '22023';
  end if;

  for batch in
    select item
    from jsonb_array_elements(p_batches) with ordinality
      as input(item, position)
    order by position
  loop
    batch_kind := batch ->> 'kind';
    batch_student_id := (batch ->> 'student_id')::uuid;

    if batch_kind = 'regular' then
      created_assignment_id := private.create_assignment_with_delivery_v5(
        batch ->> 'title',
        (batch ->> 'dataset_id')::uuid,
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'unit_ids') as input(value)
        ),
        (batch ->> 'question_count')::integer,
        (batch ->> 'english_to_korean_ratio')::smallint,
        (batch ->> 'time_limit_seconds')::integer,
        (batch ->> 'passing_score')::smallint,
        (batch ->> 'question_order_mode')::public.question_order_mode,
        nullif(batch ->> 'available_until', '')::timestamptz,
        array[batch_student_id],
        batch ->> 'timing_mode',
        nullif(batch ->> 'question_time_limit_seconds', '')::integer,
        batch -> 'questions'
      );
    elsif batch_kind = 'mixed' then
      created_assignment_id := private.create_mixed_review_assignment_v7(
        batch_student_id,
        (batch ->> 'dataset_id')::uuid,
        array(
          select value::smallint
          from jsonb_array_elements_text(batch -> 'review_levels')
            as input(value)
        ),
        coalesce(batch ->> 'review_scope', 'dataset'),
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'selected_queue_ids')
            as input(value)
        ),
        batch ->> 'title',
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'unit_ids') as input(value)
        ),
        (batch ->> 'english_to_korean_ratio')::smallint,
        (batch ->> 'time_limit_seconds')::integer,
        (batch ->> 'passing_score')::smallint,
        (batch ->> 'question_order_mode')::public.question_order_mode,
        nullif(batch ->> 'available_until', '')::timestamptz,
        batch ->> 'timing_mode',
        nullif(batch ->> 'question_time_limit_seconds', '')::integer,
        batch -> 'questions'
      );
    else
      raise exception 'invalid_bulk_assignment_kind'
        using errcode = '22023';
    end if;

    results := results || jsonb_build_array(jsonb_build_object(
      'student_id', batch_student_id,
      'assignment_id', created_assignment_id
    ));
  end loop;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.bulk_vocab_v2_created',
    (select auth.uid()),
    jsonb_build_object(
      'studentIds', to_jsonb(student_ids),
      'assignmentIds', (
        select coalesce(jsonb_agg(item -> 'assignment_id'), '[]'::jsonb)
        from jsonb_array_elements(results) as input(item)
      )
    )
  );

  return results;
end;
$$;

create function public.create_bulk_vocab_assignments_v2(
  p_batches jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_bulk_vocab_assignments_v2(p_batches);
$$;

revoke all on function private.create_bulk_vocab_assignments_v2(jsonb)
  from public, anon;
grant execute on function private.create_bulk_vocab_assignments_v2(jsonb)
  to authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v2(jsonb)
  from public, anon;
grant execute on function public.create_bulk_vocab_assignments_v2(jsonb)
  to authenticated, service_role;

commit;
