begin;

-- Rebuild the mixed queue snapshot from the active release. A queue keeps its
-- historical source occurrence, while the new assignment may use a different
-- current occurrence with the same dictionary_id.
create or replace function private.create_mixed_review_assignment_v8(
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
    or jsonb_array_length(p_questions) not between 4 and 500
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
      review_question_count >= total_question_count
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

  select release.release_id
  into active_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
  for share;
  if active_release_id is null
    and exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    )
  then
    raise exception 'exam_use_release_inactive' using errcode = '55000';
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.id = any(p_selected_queue_ids)
  order by queue.id
  for update;

  with queue_candidates as materialized (
    select
      queue.id,
      queue.reason_level,
      queue.queued_at,
      candidate.vocab_entry_id,
      candidate.dictionary_id,
      candidate.canonical_lexeme_id,
      candidate.headword_normalized
    from public.student_vocab_review_queue as queue
    join public.vocab_entries as queue_entry
      on queue_entry.id = queue.vocab_entry_id
     and queue_entry.dataset_id = queue.dataset_id
    join lateral (
      select
        entry.id as vocab_entry_id,
        occurrence.dictionary_id,
        identity.canonical_lexeme_id,
        entry.headword_normalized,
        entry.source_row
      from public.vocab_entries as entry
      left join word_index.app_exam_use_occurrence as occurrence
        on occurrence.release_id = active_release_id
       and occurrence.dataset_id = entry.dataset_id
       and occurrence.vocab_entry_id = entry.id
       and occurrence.include_in_exam
       and occurrence.exam_use_status = 'reviewed_for_preview'
      left join lateral (
        select min(eligibility.canonical_lexeme_id::text)::uuid
          as canonical_lexeme_id
        from public.vocab_entry_quiz_eligibility as eligibility
        where eligibility.vocab_entry_id = entry.id
          and eligibility.dataset_id = entry.dataset_id
          and eligibility.status = 'eligible'
      ) as identity on true
      where entry.dataset_id = p_dataset_id
        and (
          (active_release_id is not null
            and occurrence.dictionary_id is not null)
          or (
            active_release_id is null
            and entry.id = queue.vocab_entry_id
            and exists (
              select 1
              from public.vocab_entry_quiz_eligibility as eligibility
              where eligibility.vocab_entry_id = entry.id
                and eligibility.dataset_id = entry.dataset_id
                and eligibility.status = 'eligible'
            )
          )
        )
        and (
          p_review_scope = 'dataset'
          or entry.unit_id = any(p_primary_unit_ids)
        )
        and private.vocab_identity_matches_v1(
          queue.dataset_id,
          queue.vocab_entry_id,
          queue.canonical_dictionary_id_snapshot,
          queue.canonical_lexeme_id_snapshot,
          queue_entry.headword_normalized,
          entry.dataset_id,
          entry.id,
          occurrence.dictionary_id,
          identity.canonical_lexeme_id,
          entry.headword_normalized
        )
      order by
        (entry.id = queue.vocab_entry_id) desc,
        entry.source_row,
        entry.id
      limit 1
    ) as candidate on true
    where queue.student_id = p_student_id
      and queue.dataset_id = p_dataset_id
      and queue.status = 'pending'
      and queue.reserved_review_draft_id is null
      and queue.reason_level = any(p_review_levels)
  ),
  available_queue as materialized (
    select candidate.*
    from queue_candidates as candidate
    where not exists (
      select 1
      from public.assignment_students as link
      join public.assignments as assignment
        on assignment.id = link.assignment_id
       and assignment.dataset_id = p_dataset_id
       and assignment.status <> 'closed'
      join public.assignment_questions as question
        on question.assignment_id = assignment.id
      join public.vocab_entries as active_entry
        on active_entry.id = question.vocab_entry_id
       and active_entry.dataset_id = assignment.dataset_id
      left join public.assignment_question_exam_use_snapshot
        as active_snapshot
        on active_snapshot.assignment_question_id = question.id
      left join lateral (
        select min(eligibility.canonical_lexeme_id::text)::uuid
          as canonical_lexeme_id
        from public.vocab_entry_quiz_eligibility as eligibility
        where eligibility.vocab_entry_id = question.vocab_entry_id
          and eligibility.dataset_id = assignment.dataset_id
          and eligibility.status = 'eligible'
      ) as active_identity on true
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
        and private.vocab_identity_matches_v1(
          p_dataset_id,
          candidate.vocab_entry_id,
          candidate.dictionary_id,
          candidate.canonical_lexeme_id,
          candidate.headword_normalized,
          assignment.dataset_id,
          question.vocab_entry_id,
          active_snapshot.dictionary_id,
          coalesce(
            question.canonical_lexeme_id_snapshot,
            active_identity.canonical_lexeme_id
          ),
          coalesce(
            question.headword_normalized_snapshot,
            active_entry.headword_normalized
          )
        )
    )
  ),
  ranked_queue as materialized (
    select
      available.*,
      row_number() over (
        partition by coalesce(
          'dictionary:' || available.dictionary_id,
          'canonical:' || available.canonical_lexeme_id::text,
          'headword:' || lower(trim(replace(
            available.headword_normalized,
            '*',
            ''
          ))),
          'entry:' || available.vocab_entry_id::text
        )
        order by
          available.reason_level desc,
          available.queued_at,
          available.id
      ) as identity_rank
    from available_queue as available
  )
  select coalesce(
    array_agg(
      ranked.id
      order by ranked.reason_level desc, ranked.queued_at, ranked.id
    ),
    array[]::uuid[]
  )
  into current_queue_ids
  from ranked_queue as ranked
  where ranked.identity_rank = 1;

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
      or count(distinct question.base_order_index) <>
        total_question_count
      or min(question.base_order_index) <> 1
      or max(question.base_order_index) <> total_question_count
      or count(distinct question.vocab_entry_id) <>
        total_question_count
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
    from unnest(p_selected_queue_ids) with ordinality
      as selected(queue_id, position)
    join public.student_vocab_review_queue as queue
      on queue.id = selected.queue_id
    join public.vocab_entries as queue_entry
      on queue_entry.id = queue.vocab_entry_id
     and queue_entry.dataset_id = queue.dataset_id
    left join jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    ) on question.base_order_index =
      total_question_count - review_question_count + selected.position
    left join public.vocab_entries as question_entry
      on question_entry.id = question.vocab_entry_id
     and question_entry.dataset_id = p_dataset_id
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = active_release_id
     and occurrence.dataset_id = p_dataset_id
     and occurrence.vocab_entry_id = question.vocab_entry_id
     and occurrence.include_in_exam
     and occurrence.exam_use_status = 'reviewed_for_preview'
    left join lateral (
      select min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = question.vocab_entry_id
        and eligibility.dataset_id = p_dataset_id
        and eligibility.status = 'eligible'
    ) as question_identity on true
    where question.vocab_entry_id is null
      or question_entry.id is null
      or not private.vocab_identity_matches_v1(
        queue.dataset_id,
        queue.vocab_entry_id,
        queue.canonical_dictionary_id_snapshot,
        queue.canonical_lexeme_id_snapshot,
        queue_entry.headword_normalized,
        p_dataset_id,
        question.vocab_entry_id,
        occurrence.dictionary_id,
        question_identity.canonical_lexeme_id,
        question_entry.headword_normalized
      )
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
      or primary_unit_count <>
        last_primary_sort - first_primary_sort + 1
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
      left join public.vocab_entries as entry
        on entry.id = question.vocab_entry_id
       and entry.dataset_id = p_dataset_id
      where question.base_order_index <=
        total_question_count - review_question_count
        and (
          entry.id is null
          or entry.unit_id <> all(p_primary_unit_ids)
        )
    ) then
      raise exception 'mixed_regular_target_outside_primary_units'
        using errcode = '22023';
    end if;
  end if;

  -- No pending word outside the selected snapshot may be smuggled in as a
  -- regular prefix question.
  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    join public.vocab_entries as question_entry
      on question_entry.id = question.vocab_entry_id
     and question_entry.dataset_id = p_dataset_id
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = active_release_id
     and occurrence.dataset_id = p_dataset_id
     and occurrence.vocab_entry_id = question.vocab_entry_id
     and occurrence.include_in_exam
     and occurrence.exam_use_status = 'reviewed_for_preview'
    left join lateral (
      select min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = question.vocab_entry_id
        and eligibility.dataset_id = p_dataset_id
        and eligibility.status = 'eligible'
    ) as question_identity on true
    where question.base_order_index <=
      total_question_count - review_question_count
      and exists (
        select 1
        from public.student_vocab_review_queue as queue
        join public.vocab_entries as queue_entry
          on queue_entry.id = queue.vocab_entry_id
         and queue_entry.dataset_id = queue.dataset_id
        where queue.student_id = p_student_id
          and queue.dataset_id = p_dataset_id
          and queue.status = 'pending'
          and queue.id <> all(p_selected_queue_ids)
          and private.vocab_identity_matches_v1(
            queue.dataset_id,
            queue.vocab_entry_id,
            queue.canonical_dictionary_id_snapshot,
            queue.canonical_lexeme_id_snapshot,
            queue_entry.headword_normalized,
            p_dataset_id,
            question.vocab_entry_id,
            occurrence.dictionary_id,
            question_identity.canonical_lexeme_id,
            question_entry.headword_normalized
          )
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
    select choice.vocab_entry_id
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      choice_vocab_entry_ids bigint[]
    )
    cross join lateral unnest(question.choice_vocab_entry_ids)
      as choice(vocab_entry_id)
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
    or cardinality(scope_unit_ids) <>
      last_scope_sort - first_scope_sort + 1
  then
    raise exception 'review_question_support_scope_not_contiguous'
      using errcode = '22023';
  end if;

  created_assignment_id := private.create_assignment_with_delivery_v6(
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

  update public.assignments
  set assignment_purpose = case
    when cardinality(p_primary_unit_ids) = 0 then 'review'
    else 'mixed'
  end
  where id = created_assignment_id;
  update public.assignment_units
  set is_primary = unit_id = any(p_primary_unit_ids)
  where assignment_id = created_assignment_id;

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
    raise exception 'assignment_review_target_insert_mismatch'
      using errcode = '21000';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.mixed_review_v8_created',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'releaseId', active_release_id,
      'reviewLevels', to_jsonb(p_review_levels),
      'reviewScope', p_review_scope,
      'selectedQueueIds', to_jsonb(p_selected_queue_ids),
      'timingMode', p_timing_mode
    )
  );

  return created_assignment_id;
end;
$$;

revoke all on function private.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

-- Rebuild the draft-compatible persistence body after normalizing line
-- endings. The first cutover migration could miss this predicate on CRLF
-- deployments and leave null-draft mixed replacements unusable.
do $migration$
declare
  function_definition text;
begin
  select replace(
    pg_get_functiondef(
      'private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  )
  into function_definition;

  if position(
    'private.create_assignment_with_question_bank_v3('
    in function_definition
  ) = 0
    or position(
      E'p_review_draft_id is null\n      or total_question_count <> review_question_count'
      in function_definition
    ) = 0
  then
    raise exception 'persist_review_assignment_v5_normalized_shape_changed';
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
    E'p_review_draft_id is null\n      or total_question_count <> review_question_count'
    in function_definition
  ) > 0
  then
    raise exception 'persist_review_assignment_v6_normalized_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- The replacement coordinator keeps its mature locking/idempotency ledger,
-- but links selected historical queues to the review-question tail by order.
-- The target trigger then verifies dictionary identity and stores the current
-- release entry instead of requiring the historical entry id to be identical.
do $migration$
declare
  function_definition text;
begin
  select replace(
    pg_get_functiondef(
      'private.replace_student_assignment_v3(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  )
  into function_definition;

  if position(
    E'join public.assignment_questions as question\n      on question.assignment_id = created_replacement_assignment_id\n      and question.vocab_entry_id = queue.vocab_entry_id'
    in function_definition
  ) = 0
    or position(
      E'perform private.link_pending_review_targets_v1(\n      created_replacement_assignment_id,\n      array[p_student_id]\n    );'
      in function_definition
    ) = 0
  then
    raise exception 'replace_student_assignment_v3_dictionary_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    E'join public.assignment_questions as question\n      on question.assignment_id = created_replacement_assignment_id\n      and question.vocab_entry_id = queue.vocab_entry_id',
    E'join public.assignment_questions as question\n      on question.assignment_id = created_replacement_assignment_id\n      and question.base_order_index = p_question_count\n        - cardinality(p_selected_queue_ids) + selected.position'
  );
  function_definition := replace(
    function_definition,
    E'perform private.link_pending_review_targets_v1(\n      created_replacement_assignment_id,\n      array[p_student_id]\n    );',
    E'perform private.link_pending_review_targets_v2(\n      created_replacement_assignment_id,\n      array[p_student_id],\n      null\n    );'
  );
  execute function_definition;
end;
$migration$;

-- Qualify the unnested identifier because the RETURNS TABLE output column is
-- also named assignment_id in PL/pgSQL.
create or replace function public.list_assignment_question_dictionary_identities_v1(
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

revoke all on function
  public.list_assignment_question_dictionary_identities_v1(uuid[], uuid)
  from public, anon;
grant execute on function
  public.list_assignment_question_dictionary_identities_v1(uuid[], uuid)
  to authenticated, service_role;

-- Fold a legacy UUID-backed state into a newer dictionary-backed state before
-- counting current wrong words. Strong conflicting IDs still stay separate.
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
  unresolved_base as materialized (
    select
      student.id as student_id,
      student.dataset_id,
      state.vocab_entry_id,
      state.canonical_dictionary_id_snapshot as dictionary_id,
      entry_identity.canonical_lexeme_id,
      entry.headword_normalized
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
  unresolved_rows as materialized (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.vocab_entry_id,
      coalesce(
        unresolved.dictionary_id,
        dictionary_bridge.dictionary_id
      ) as dictionary_id,
      unresolved.canonical_lexeme_id,
      unresolved.headword_normalized,
      case
        when coalesce(
          unresolved.dictionary_id,
          dictionary_bridge.dictionary_id
        ) is not null
          then 'dictionary:' || coalesce(
            unresolved.dictionary_id,
            dictionary_bridge.dictionary_id
          )
        when unresolved.canonical_lexeme_id is not null
          then 'canonical:' || unresolved.canonical_lexeme_id::text
        else 'headword:' || lower(trim(replace(
          unresolved.headword_normalized,
          '*',
          ''
        )))
      end as word_key
    from unresolved_base as unresolved
    left join lateral (
      select candidate.dictionary_id
      from unresolved_base as candidate
      where candidate.student_id = unresolved.student_id
        and candidate.dataset_id = unresolved.dataset_id
        and candidate.dictionary_id is not null
        and private.vocab_identity_matches_v1(
          unresolved.dataset_id,
          unresolved.vocab_entry_id,
          unresolved.dictionary_id,
          unresolved.canonical_lexeme_id,
          unresolved.headword_normalized,
          candidate.dataset_id,
          candidate.vocab_entry_id,
          candidate.dictionary_id,
          candidate.canonical_lexeme_id,
          candidate.headword_normalized
        )
      order by candidate.dictionary_id
      limit 1
    ) as dictionary_bridge on true
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

notify pgrst, 'reload schema';

commit;
