begin;

create function private.create_exact_review_assignment_v4(
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
  review_question_count integer;
  locked_queue_count integer;
  referenced_input_count integer;
  referenced_entry_count integer;
  first_scope_sort integer;
  last_scope_sort integer;
  scope_unit_ids uuid[];
  created_assignment_id uuid;
  consumed_queue_count integer;
  consumed_draft_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_review_draft_id is null
    or p_english_to_korean_ratio is null
    or p_english_to_korean_ratio not in (0, 50, 100)
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) not between 1 and 400
  then
    raise exception 'invalid_exact_review_assignment_input'
      using errcode = '22023';
  end if;

  -- Read the identity first, then acquire every mutable lock in the same
  -- student -> queue -> draft order as the producer.
  select
    draft.student_id,
    draft.dataset_id
  into
    draft_student_id,
    draft_dataset_id
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = p_review_draft_id;

  if draft_student_id is null or draft_dataset_id is null then
    raise exception 'review_assignment_draft_not_found'
      using errcode = '22023';
  end if;

  perform 1
  from public.students as student
  where student.id = draft_student_id
    and student.status = 'active'
  for update;

  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  select
    array_agg(item.queue_id order by item.position)
  into review_queue_ids
  from public.student_vocab_review_assignment_draft_items as item
  where item.draft_id = p_review_draft_id;

  review_question_count := cardinality(review_queue_ids);
  if review_queue_ids is null
    or review_question_count not between 1 and 400
    or review_question_count <> (
      select count(distinct queue_id)
      from unnest(review_queue_ids) as selected(queue_id)
      where queue_id is not null
    )
    or jsonb_array_length(p_questions) <> review_question_count
  then
    raise exception 'invalid_exact_review_draft_items'
      using errcode = '21000';
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.id = any(review_queue_ids)
  order by queue.id
  for update;

  select count(*)
  into locked_queue_count
  from public.student_vocab_review_queue as queue
  where queue.id = any(review_queue_ids)
    and queue.student_id = draft_student_id
    and queue.dataset_id = draft_dataset_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = p_review_draft_id;

  if locked_queue_count <> review_question_count then
    raise exception 'review_draft_queue_changed'
      using errcode = '40001';
  end if;

  perform 1
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = p_review_draft_id
    and draft.student_id = draft_student_id
    and draft.dataset_id = draft_dataset_id
    and draft.status = 'pending'
    and draft.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception 'review_assignment_draft_unavailable'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'invalid_exact_review_question_plan'
      using errcode = '22023';
  end if;

  if (
    select
      count(*) <> review_question_count
      or count(distinct question.base_order_index)
        <> review_question_count
      or min(question.base_order_index) <> 1
      or max(question.base_order_index) <> review_question_count
      or count(distinct question.vocab_entry_id)
        <> review_question_count
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

  -- Fixed order follows the teacher's durable draft selection order.
  if exists (
    select 1
    from public.student_vocab_review_assignment_draft_items as item
    join public.student_vocab_review_queue as queue
      on queue.id = item.queue_id
    left join jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
      on question.base_order_index = item.position
     and question.vocab_entry_id = queue.vocab_entry_id
    where item.draft_id = p_review_draft_id
      and question.vocab_entry_id is null
  ) then
    raise exception 'exact_review_target_order_mismatch'
      using errcode = '22023';
  end if;

  -- Compare both directions so no queue target can be omitted or padded.
  if exists (
    select queue.vocab_entry_id
    from public.student_vocab_review_queue as queue
    where queue.id = any(review_queue_ids)
    except
    select question.vocab_entry_id
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  )
  or exists (
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
    where queue.id = any(review_queue_ids)
  ) then
    raise exception 'exact_review_target_set_mismatch'
      using errcode = '22023';
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
     and eligibility.dataset_id = draft_dataset_id
     and eligibility.quiz_mode = case question.direction
       when 'english_to_korean'
         then 'book_meaning_en_to_ko'
       when 'korean_to_english'
         then 'book_meaning_ko_to_en'
       else null
     end
    where queue.id = any(review_queue_ids)
      and queue.canonical_lexeme_id_snapshot is not null
      and queue.canonical_lexeme_id_snapshot
        is distinct from eligibility.canonical_lexeme_id
  ) then
    raise exception 'review_target_canonical_mapping_changed'
      using errcode = '22023';
  end if;

  -- The v2 core already checks four distinct rendered values. Add the missing
  -- identity guard so two occurrences of one canonical word cannot be choices.
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
       and choice_entry.dataset_id = draft_dataset_id
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

  -- Derive the smallest contiguous support scope containing every target and
  -- choice. Support units never become curriculum progress for review purpose.
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
    first_scope_sort,
    last_scope_sort
  from referenced_entry_ids as referenced
  left join public.vocab_entries as entry
    on entry.id = referenced.vocab_entry_id
   and entry.dataset_id = draft_dataset_id
  left join public.vocab_units as unit
    on unit.id = entry.unit_id
   and unit.dataset_id = entry.dataset_id;

  if referenced_input_count <> referenced_entry_count
    or first_scope_sort is null
    or last_scope_sort is null
  then
    raise exception 'review_question_entry_dataset_mismatch'
      using errcode = '22023';
  end if;

  select array_agg(unit.id order by unit.sort_index)
  into scope_unit_ids
  from public.vocab_units as unit
  where unit.dataset_id = draft_dataset_id
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
      draft_dataset_id,
      scope_unit_ids,
      review_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      array[draft_student_id],
      p_questions
    );

  if (
    select count(*)
    from public.assignment_questions as question
    where question.assignment_id = created_assignment_id
      and question.vocab_entry_id = any(
        select queue.vocab_entry_id
        from public.student_vocab_review_queue as queue
        where queue.id = any(review_queue_ids)
      )
  ) <> review_question_count then
    raise exception 'created_review_target_set_mismatch'
      using errcode = '21000';
  end if;

  update public.assignments
  set assignment_purpose = 'review'
  where id = created_assignment_id;

  update public.assignment_units
  set is_primary = false
  where assignment_id = created_assignment_id;

  update public.student_vocab_review_queue as queue
  set
    status = 'consumed',
    consumed_assignment_id = created_assignment_id,
    consumed_at = clock_timestamp(),
    reserved_review_draft_id = null,
    reserved_at = null
  where queue.id = any(review_queue_ids)
    and queue.student_id = draft_student_id
    and queue.dataset_id = draft_dataset_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = p_review_draft_id;

  get diagnostics consumed_queue_count = row_count;
  if consumed_queue_count <> review_question_count then
    raise exception 'review_queue_consume_mismatch'
      using errcode = '40001';
  end if;

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
    draft_student_id,
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'draftId', p_review_draft_id,
      'datasetId', draft_dataset_id,
      'purpose', 'review',
      'questionCount', review_question_count,
      'queueIds', to_jsonb(review_queue_ids),
      'scopeUnitIds', to_jsonb(scope_unit_ids)
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_exact_review_assignment_v4(
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
language sql
security invoker
set search_path = ''
as $$
  select private.create_exact_review_assignment_v4(
    p_review_draft_id,
    p_title,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_questions
  );
$$;

revoke all on function private.create_exact_review_assignment_v4(
  uuid,
  text,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) from public, anon, authenticated;

revoke all on function public.create_exact_review_assignment_v4(
  uuid,
  text,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) from public, anon;

grant execute on function private.create_exact_review_assignment_v4(
  uuid,
  text,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) to authenticated, service_role;

grant execute on function public.create_exact_review_assignment_v4(
  uuid,
  text,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  timestamptz,
  jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
