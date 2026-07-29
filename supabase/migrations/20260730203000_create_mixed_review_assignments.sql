begin;

do $$
begin
  if to_regprocedure(
    'private.create_exact_review_assignment_v4(uuid,text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'
  ) is null then
    raise exception 'required_exact_review_assignment_v4_missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assignments'
      and column_name = 'assignment_purpose'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assignment_units'
      and column_name = 'is_primary'
  ) then
    raise exception 'review_assignment_foundation_missing';
  end if;
end;
$$;

-- Persist both exact-review and mixed-review assignments through one
-- validation path. The caller supplies an ordered, already selected queue
-- snapshot; this function locks and revalidates every mutable row.
create function private.persist_review_assignment_v5(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_queue_ids uuid[],
  p_review_draft_id uuid,
  p_title text,
  p_primary_unit_ids uuid[],
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
  derived_assignment_purpose text;
  review_question_count integer;
  total_question_count integer;
  locked_queue_count integer;
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
  created_assignment_id uuid;
  persisted_review_count integer;
  persisted_question_count integer;
  consumed_queue_count integer;
  consumed_draft_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_review_queue_ids is null
    or cardinality(p_review_queue_ids) not between 1 and 400
    or cardinality(p_review_queue_ids) <> (
      select count(distinct selected.queue_id)
      from unnest(p_review_queue_ids) as selected(queue_id)
      where selected.queue_id is not null
    )
    or p_primary_unit_ids is null
    or p_english_to_korean_ratio is null
    or p_english_to_korean_ratio not in (0, 50, 100)
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) not between 1 and 500
  then
    raise exception 'invalid_review_assignment_input'
      using errcode = '22023';
  end if;

  review_question_count := cardinality(p_review_queue_ids);
  total_question_count := jsonb_array_length(p_questions);
  derived_assignment_purpose := case
    when cardinality(p_primary_unit_ids) = 0 then 'review'
    else 'mixed'
  end;

  if (
    derived_assignment_purpose = 'review'
    and (
      p_review_draft_id is null
      or total_question_count <> review_question_count
    )
  )
  or (
    derived_assignment_purpose = 'mixed'
    and (
      p_review_draft_id is not null
      or total_question_count not between 4 and 500
      or review_question_count >= total_question_count
      or cardinality(p_primary_unit_ids) <> (
        select count(distinct selected.unit_id)
        from unnest(p_primary_unit_ids) as selected(unit_id)
        where selected.unit_id is not null
      )
    )
  ) then
    raise exception 'invalid_review_assignment_mode'
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

  -- Every producer, reserver and consumer uses student -> queue(id) order.
  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.id = any(p_review_queue_ids)
  order by queue.id
  for update;

  select count(*)
  into locked_queue_count
  from public.student_vocab_review_queue as queue
  where queue.id = any(p_review_queue_ids)
    and queue.student_id = p_student_id
    and queue.dataset_id = p_dataset_id
    and queue.status = 'pending'
    and (
      (
        p_review_draft_id is null
        and queue.reserved_review_draft_id is null
      )
      or queue.reserved_review_draft_id = p_review_draft_id
    );

  if locked_queue_count <> review_question_count then
    raise exception 'review_queue_selection_changed'
      using errcode = '40001';
  end if;

  if p_review_draft_id is not null then
    perform 1
    from public.student_vocab_review_assignment_drafts as draft
    where draft.id = p_review_draft_id
      and draft.student_id = p_student_id
      and draft.dataset_id = p_dataset_id
      and draft.status = 'pending'
      and draft.expires_at > clock_timestamp()
    for update;

    if not found then
      raise exception 'review_assignment_draft_unavailable'
        using errcode = '40001';
    end if;

    if (
      select count(*)
      from public.student_vocab_review_assignment_draft_items as item
      where item.draft_id = p_review_draft_id
        and item.queue_id = any(p_review_queue_ids)
    ) <> review_question_count
    or (
      select count(*)
      from public.student_vocab_review_assignment_draft_items as item
      where item.draft_id = p_review_draft_id
    ) <> review_question_count
    then
      raise exception 'review_assignment_draft_items_changed'
        using errcode = '40001';
    end if;

    if (
      select array_agg(item.queue_id order by item.position)
      from public.student_vocab_review_assignment_draft_items as item
      where item.draft_id = p_review_draft_id
    ) is distinct from p_review_queue_ids then
      raise exception 'review_assignment_draft_order_changed'
        using errcode = '40001';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'invalid_review_question_plan'
      using errcode = '22023';
  end if;

  if (
    select
      count(*) <> total_question_count
      or count(distinct question.base_order_index)
        <> total_question_count
      or min(question.base_order_index) <> 1
      or max(question.base_order_index) <> total_question_count
      or count(distinct question.vocab_entry_id)
        <> total_question_count
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  ) then
    raise exception 'invalid_review_question_plan'
      using errcode = '22023';
  end if;

  -- Review targets occupy the tail of a mixed fixed order. Exact review has
  -- no primary prefix, so this remains identical to the v4 draft order.
  if exists (
    select 1
    from unnest(p_review_queue_ids) with ordinality
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

  -- Every selected queue target must occur exactly once.
  if exists (
    select queue.vocab_entry_id
    from public.student_vocab_review_queue as queue
    where queue.id = any(p_review_queue_ids)
    except
    select question.vocab_entry_id
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  ) then
    raise exception 'review_target_set_mismatch'
      using errcode = '22023';
  end if;

  if derived_assignment_purpose = 'review'
    and exists (
      select question.vocab_entry_id
      from jsonb_to_recordset(p_questions) as question(
        vocab_entry_id bigint,
        base_order_index integer,
        direction text,
        choice_vocab_entry_ids bigint[]
      )
      except
      select queue.vocab_entry_id
      from public.student_vocab_review_queue as queue
      where queue.id = any(p_review_queue_ids)
    )
  then
    raise exception 'exact_review_target_set_mismatch'
      using errcode = '22023';
  end if;

  if derived_assignment_purpose = 'mixed' then
    select
      count(*),
      min(unit.sort_index),
      max(unit.sort_index)
    into
      primary_unit_count,
      first_primary_sort,
      last_primary_sort
    from public.vocab_units as unit
    where unit.dataset_id = p_dataset_id
      and unit.id = any(p_primary_unit_ids);

    if primary_unit_count <> cardinality(p_primary_unit_ids)
      or first_primary_sort is null
      or last_primary_sort is null
      or primary_unit_count
        <> last_primary_sort - first_primary_sort + 1
    then
      raise exception 'mixed_primary_units_invalid'
        using errcode = '22023';
    end if;

    -- A non-review target is new curriculum content and must be from a
    -- selected primary DAY, never from a bridge/support unit.
    if exists (
      select 1
      from jsonb_to_recordset(p_questions) as question(
        vocab_entry_id bigint,
        base_order_index integer,
        direction text,
        choice_vocab_entry_ids bigint[]
      )
      left join public.student_vocab_review_queue as queue
        on queue.id = any(p_review_queue_ids)
       and queue.vocab_entry_id = question.vocab_entry_id
      left join public.vocab_entries as entry
        on entry.id = question.vocab_entry_id
      where queue.id is null
        and (
          entry.id is null
          or entry.dataset_id <> p_dataset_id
          or entry.unit_id <> all(p_primary_unit_ids)
        )
    ) then
      raise exception 'mixed_regular_target_outside_primary_units'
        using errcode = '22023';
    end if;

    -- A general target must actually be new for this student. An unselected
    -- pending item (including one reserved by an exact-review draft) must not
    -- be presented as ordinary DAY content and then remain in the queue.
    if exists (
      select 1
      from jsonb_to_recordset(p_questions) as question(
        vocab_entry_id bigint,
        base_order_index integer,
        direction text,
        choice_vocab_entry_ids bigint[]
      )
      left join public.vocab_entry_quiz_eligibility
        as target_eligibility
        on target_eligibility.vocab_entry_id =
          question.vocab_entry_id
       and target_eligibility.dataset_id = p_dataset_id
       and target_eligibility.quiz_mode = case question.direction
         when 'english_to_korean'
           then 'book_meaning_en_to_ko'
         when 'korean_to_english'
           then 'book_meaning_ko_to_en'
         else null
       end
      where not exists (
        select 1
        from public.student_vocab_review_queue as selected_queue
        where selected_queue.id = any(p_review_queue_ids)
          and selected_queue.vocab_entry_id =
            question.vocab_entry_id
      )
      and exists (
        select 1
        from public.student_vocab_review_queue as pending_queue
        where pending_queue.student_id = p_student_id
          and pending_queue.dataset_id = p_dataset_id
          and pending_queue.status = 'pending'
          and (
            pending_queue.vocab_entry_id =
              question.vocab_entry_id
            or (
              pending_queue.canonical_lexeme_id_snapshot
                is not null
              and target_eligibility.canonical_lexeme_id
                is not null
              and pending_queue.canonical_lexeme_id_snapshot =
                target_eligibility.canonical_lexeme_id
            )
          )
      )
    ) then
      raise exception 'mixed_regular_target_already_pending_review'
        using errcode = '22023';
    end if;
  end if;

  -- Reject a stale queue snapshot if its canonical mapping changed.
  if exists (
    select 1
    from public.student_vocab_review_queue as queue
    join jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
      on question.vocab_entry_id = queue.vocab_entry_id
    left join public.vocab_entry_quiz_eligibility as eligibility
      on eligibility.vocab_entry_id = question.vocab_entry_id
     and eligibility.dataset_id = p_dataset_id
     and eligibility.quiz_mode = case question.direction
       when 'english_to_korean'
         then 'book_meaning_en_to_ko'
       when 'korean_to_english'
         then 'book_meaning_ko_to_en'
       else null
     end
    where queue.id = any(p_review_queue_ids)
      and queue.canonical_lexeme_id_snapshot is not null
      and queue.canonical_lexeme_id_snapshot
        is distinct from eligibility.canonical_lexeme_id
  ) then
    raise exception 'review_target_canonical_mapping_changed'
      using errcode = '22023';
  end if;

  -- Four rendered choices and their canonical identities must all differ.
  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    cross join lateral (
      select
        count(*) as choice_count,
        count(distinct coalesce(
          choice_eligibility.canonical_lexeme_id::text,
          'headword:' || lower(normalize(
            trim(choice_entry.headword_normalized),
            NFKC
          ))
        )) as distinct_identity_count
      from unnest(question.choice_vocab_entry_ids)
        as selected_choice(vocab_entry_id)
      join public.vocab_entries as choice_entry
        on choice_entry.id = selected_choice.vocab_entry_id
       and choice_entry.dataset_id = p_dataset_id
      left join public.vocab_entry_quiz_eligibility
        as choice_eligibility
        on choice_eligibility.vocab_entry_id = choice_entry.id
       and choice_eligibility.dataset_id = choice_entry.dataset_id
       and choice_eligibility.quiz_mode = case question.direction
         when 'english_to_korean'
           then 'book_meaning_en_to_ko'
         when 'korean_to_english'
           then 'book_meaning_ko_to_en'
         else null
       end
    ) as identity_check
    where identity_check.choice_count <> 4
      or identity_check.distinct_identity_count <> 4
  ) then
    raise exception 'review_choice_canonical_identity_not_distinct'
      using errcode = '22023';
  end if;

  -- Support units cover every target, every choice and every primary DAY.
  -- Only primary units will count toward curriculum progress.
  with referenced_entry_ids as (
    select question.vocab_entry_id
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    union
    select selected_choice.vocab_entry_id
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
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
    when derived_assignment_purpose = 'mixed'
      then least(first_referenced_sort, first_primary_sort)
    else first_referenced_sort
  end;
  last_scope_sort := case
    when derived_assignment_purpose = 'mixed'
      then greatest(last_referenced_sort, last_primary_sort)
    else last_referenced_sort
  end;

  select array_agg(unit.id order by unit.sort_index)
  into scope_unit_ids
  from public.vocab_units as unit
  where unit.dataset_id = p_dataset_id
    and unit.sort_index between first_scope_sort and last_scope_sort;

  if scope_unit_ids is null
    or cardinality(scope_unit_ids)
      <> last_scope_sort - first_scope_sort + 1
  then
    raise exception 'review_question_support_scope_not_contiguous'
      using errcode = '22023';
  end if;

  created_assignment_id :=
    private.create_assignment_with_question_bank_v3(
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
      p_questions
    );

  select
    count(*),
    count(*) filter (
      where question.vocab_entry_id = any(
        select queue.vocab_entry_id
        from public.student_vocab_review_queue as queue
        where queue.id = any(p_review_queue_ids)
      )
    )
  into
    persisted_question_count,
    persisted_review_count
  from public.assignment_questions as question
  where question.assignment_id = created_assignment_id;

  if persisted_question_count <> total_question_count
    or persisted_review_count <> review_question_count
  then
    raise exception 'created_review_target_set_mismatch'
      using errcode = '21000';
  end if;

  update public.assignments
  set assignment_purpose = derived_assignment_purpose
  where id = created_assignment_id;

  update public.assignment_units as assignment_unit
  set is_primary = case
    when derived_assignment_purpose = 'mixed'
      then assignment_unit.unit_id = any(p_primary_unit_ids)
    else false
  end
  where assignment_unit.assignment_id = created_assignment_id;

  update public.student_vocab_review_queue as queue
  set
    status = 'consumed',
    consumed_assignment_id = created_assignment_id,
    consumed_at = clock_timestamp(),
    reserved_review_draft_id = null,
    reserved_at = null
  where queue.id = any(p_review_queue_ids)
    and queue.student_id = p_student_id
    and queue.dataset_id = p_dataset_id
    and queue.status = 'pending'
    and (
      (
        p_review_draft_id is null
        and queue.reserved_review_draft_id is null
      )
      or queue.reserved_review_draft_id = p_review_draft_id
    );

  get diagnostics consumed_queue_count = row_count;
  if consumed_queue_count <> review_question_count then
    raise exception 'review_queue_consume_mismatch'
      using errcode = '40001';
  end if;

  if p_review_draft_id is not null then
    update public.student_vocab_review_assignment_drafts as draft
    set
      status = 'consumed',
      consumed_assignment_id = created_assignment_id,
      consumed_at = clock_timestamp()
    where draft.id = p_review_draft_id
      and draft.status = 'pending';

    get diagnostics consumed_draft_count = row_count;
    if consumed_draft_count <> 1 then
      raise exception 'review_draft_consume_mismatch'
        using errcode = '40001';
    end if;
  end if;

  if p_available_until is not null
    and p_available_until <= clock_timestamp()
  then
    raise exception 'assignment_deadline_elapsed_during_review_creation'
      using errcode = '22023';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.review_queue_consumed',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'draftId', p_review_draft_id,
      'datasetId', p_dataset_id,
      'purpose', derived_assignment_purpose,
      'questionCount', total_question_count,
      'reviewQuestionCount', review_question_count,
      'queueIds', to_jsonb(p_review_queue_ids),
      'primaryUnitIds', to_jsonb(p_primary_unit_ids),
      'scopeUnitIds', to_jsonb(scope_unit_ids)
    )
  );

  return created_assignment_id;
end;
$$;

-- Keep the existing exact-review public contract while routing it through
-- the common v5 persistence core.
create or replace function private.create_exact_review_assignment_v4(
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
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    draft.student_id,
    draft.dataset_id
  into
    draft_student_id,
    draft_dataset_id
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

  return private.persist_review_assignment_v5(
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

-- The server previews the deterministic top-N queue subset and sends the
-- ordered UUIDs. The database recalculates the same subset under a student
-- lock before any assignment is created or queue item is consumed.
create function private.create_mixed_review_assignment_v5(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_review_limit integer,
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
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
  current_queue_ids uuid[];
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_review_levels is null
    or cardinality(p_review_levels) not between 1 and 2
    or cardinality(p_review_levels) <> (
      select count(distinct selected.reason_level)
      from unnest(p_review_levels) as selected(reason_level)
      where selected.reason_level in (1, 2)
    )
    or p_review_limit is null
    or p_review_limit not between 1 and 400
    or p_selected_queue_ids is null
    or cardinality(p_selected_queue_ids) not between 1 and 400
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

  select coalesce(
    array_agg(
      selected.id
      order by
        selected.reason_level desc,
        selected.queued_at,
        selected.id
    ),
    array[]::uuid[]
  )
  into current_queue_ids
  from (
    select
      queue.id,
      queue.reason_level,
      queue.queued_at
    from public.student_vocab_review_queue as queue
    where queue.student_id = p_student_id
      and queue.dataset_id = p_dataset_id
      and queue.status = 'pending'
      and queue.reserved_review_draft_id is null
      and queue.reason_level = any(p_review_levels)
    order by
      queue.reason_level desc,
      queue.queued_at,
      queue.id
    limit p_review_limit
  ) as selected;

  if cardinality(current_queue_ids) = 0 then
    raise exception 'mixed_review_queue_empty'
      using errcode = '22023';
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

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.mixed_review_selected',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'reviewLevels', to_jsonb(p_review_levels),
      'reviewLimit', p_review_limit,
      'selectedQueueIds', to_jsonb(current_queue_ids)
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_mixed_review_assignment_v5(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_review_limit integer,
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_questions jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_mixed_review_assignment_v5(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_review_limit,
    p_selected_queue_ids,
    p_title,
    p_primary_unit_ids,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_questions
  );
$$;

revoke all on function private.persist_review_assignment_v5(
  uuid,
  uuid,
  uuid[],
  uuid,
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) from public, anon, authenticated;

revoke all on function private.create_mixed_review_assignment_v5(
  uuid,
  uuid,
  smallint[],
  integer,
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) from public, anon, authenticated;

revoke all on function public.create_mixed_review_assignment_v5(
  uuid,
  uuid,
  smallint[],
  integer,
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) from public, anon;

grant execute on function private.create_mixed_review_assignment_v5(
  uuid,
  uuid,
  smallint[],
  integer,
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) to authenticated, service_role;

grant execute on function public.create_mixed_review_assignment_v5(
  uuid,
  uuid,
  smallint[],
  integer,
  uuid[],
  text,
  uuid[],
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
