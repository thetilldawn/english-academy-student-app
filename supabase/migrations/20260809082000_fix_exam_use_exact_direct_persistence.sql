begin;

-- The legacy persistence body can retain CRLF from an older deployment, so
-- text-rewriting its draft-only predicate is not portable. Exact review now
-- uses the versioned delivery/linker path directly and keeps queue history
-- pending while assignment_review_targets tracks the active reservation.
create or replace function private.create_exact_review_assignment_v5(
  p_student_id uuid,
  p_dataset_id uuid,
  p_selected_queue_ids uuid[],
  p_title text,
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
  selected_queue_count integer;
  total_question_count integer;
  referenced_input_count integer;
  referenced_entry_count integer;
  first_scope_sort integer;
  last_scope_sort integer;
  scope_unit_ids uuid[];
  created_assignment_id uuid;
  linked_queue_ids uuid[];
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_selected_queue_ids is null
    or cardinality(p_selected_queue_ids) not between 4 and 400
    or cardinality(p_selected_queue_ids) <> (
      select count(distinct queue_id)
      from unnest(p_selected_queue_ids) as input(queue_id)
      where queue_id is not null
    )
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <>
      cardinality(p_selected_queue_ids)
  then
    raise exception 'invalid_exact_review_selection'
      using errcode = '22023';
  end if;
  total_question_count := jsonb_array_length(p_questions);

  perform student.id
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
    and student.deleted_at is null
  for update;
  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.id = any(p_selected_queue_ids)
  order by queue.id
  for update;

  select count(*)
  into selected_queue_count
  from public.student_vocab_review_queue as queue
  where queue.id = any(p_selected_queue_ids)
    and queue.student_id = p_student_id
    and queue.dataset_id = p_dataset_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id is null;
  if selected_queue_count <> cardinality(p_selected_queue_ids) then
    raise exception 'exact_review_queue_snapshot_changed'
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
    raise exception 'invalid_exact_review_question_plan'
      using errcode = '22023';
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
    ) on question.base_order_index = selected.position
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
        and eligibility.quiz_mode = case question.direction
          when 'english_to_korean'
            then 'book_meaning_en_to_ko'
          when 'korean_to_english'
            then 'book_meaning_ko_to_en'
          else null
        end
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
    raise exception 'exact_review_target_order_mismatch'
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
    first_scope_sort,
    last_scope_sort
  from referenced_entry_ids as referenced
  left join public.vocab_entries as entry
    on entry.id = referenced.vocab_entry_id
   and entry.dataset_id = p_dataset_id
  left join public.vocab_units as unit
    on unit.id = entry.unit_id
   and unit.dataset_id = entry.dataset_id;

  if referenced_input_count <> referenced_entry_count
    or first_scope_sort is null
    or last_scope_sort is null
  then
    raise exception 'exact_review_question_entry_dataset_mismatch'
      using errcode = '22023';
  end if;

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
    raise exception 'exact_review_support_scope_not_contiguous'
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
  set assignment_purpose = 'review'
  where id = created_assignment_id;
  update public.assignment_units
  set is_primary = false
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
    raise exception 'assignment_review_target_order_mismatch'
      using errcode = '21000';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.exact_review_v5_direct_created',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'releaseId', active_release_id,
      'selectedQueueIds', to_jsonb(p_selected_queue_ids),
      'timingMode', p_timing_mode
    )
  );

  return created_assignment_id;
end;
$$;

revoke all on function private.create_exact_review_assignment_v5(
  uuid, uuid, uuid[], text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
