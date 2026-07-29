begin;

create function private.create_student_vocab_review_assignment_draft(
  p_student_id uuid,
  p_question_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_ids uuid[];
  selected_dataset_id uuid;
  selected_queue_count integer;
  selected_dataset_count integer;
  reserved_queue_count integer;
  reserved_draft_count integer;
  reserved_draft_id uuid;
  active_draft_id uuid;
  active_draft_item_count integer;
  created_draft_id uuid;
  updated_queue_count integer;
  stale_draft_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_question_ids is null
    or cardinality(p_question_ids) not between 1 and 400
    or cardinality(p_question_ids) <> (
      select count(distinct question_id)
      from unnest(p_question_ids) as input(question_id)
      where question_id is not null
    )
  then
    raise exception 'invalid_review_draft_question_selection'
      using errcode = '22023';
  end if;

  -- Match the producer and later consumer lock order:
  -- student -> queue -> draft.
  perform 1
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
  for update;

  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  queue_ids := private.queue_student_vocab_review_words(
    p_student_id,
    p_question_ids
  );

  if queue_ids is null
    or cardinality(queue_ids) not between 1 and 400
    or cardinality(queue_ids) <> (
      select count(distinct queue_id)
      from unnest(queue_ids) as selected(queue_id)
      where queue_id is not null
    )
  then
    raise exception 'invalid_review_draft_queue_selection'
      using errcode = '21000';
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.id = any(queue_ids)
  order by queue.id
  for update;

  select
    count(*),
    count(distinct queue.dataset_id),
    min(queue.dataset_id::text)::uuid
  into
    selected_queue_count,
    selected_dataset_count,
    selected_dataset_id
  from public.student_vocab_review_queue as queue
  where queue.id = any(queue_ids)
    and queue.student_id = p_student_id
    and queue.status = 'pending';

  if selected_queue_count <> cardinality(queue_ids) then
    raise exception 'review_draft_queue_not_pending_or_owned'
      using errcode = '40001';
  end if;

  if selected_dataset_count <> 1 then
    raise exception 'review_draft_requires_single_dataset'
      using errcode = '22023';
  end if;

  -- Release only expired reservations reached by this exact selection.
  -- The student lock serializes every supported producer/consumer path.
  for stale_draft_id in
    select distinct draft.id
    from public.student_vocab_review_queue as queue
    join public.student_vocab_review_assignment_drafts as draft
      on draft.id = queue.reserved_review_draft_id
    where queue.id = any(queue_ids)
      and queue.student_id = p_student_id
      and draft.status = 'pending'
      and draft.expires_at <= clock_timestamp()
    order by draft.id
  loop
    perform 1
    from public.student_vocab_review_assignment_drafts as draft
    where draft.id = stale_draft_id
    for update;

    update public.student_vocab_review_assignment_drafts as draft
    set
      status = 'expired',
      expired_at = clock_timestamp()
    where draft.id = stale_draft_id
      and draft.status = 'pending'
      and draft.expires_at <= clock_timestamp();

    if found then
      update public.student_vocab_review_queue as queue
      set
        reserved_review_draft_id = null,
        reserved_at = null
      where queue.student_id = p_student_id
        and queue.status = 'pending'
        and queue.reserved_review_draft_id = stale_draft_id;
    end if;
  end loop;

  select
    count(*) filter (
      where queue.reserved_review_draft_id is not null
    ),
    count(distinct queue.reserved_review_draft_id),
    min(queue.reserved_review_draft_id::text)::uuid
  into
    reserved_queue_count,
    reserved_draft_count,
    reserved_draft_id
  from public.student_vocab_review_queue as queue
  where queue.id = any(queue_ids);

  if reserved_queue_count > 0 then
    if reserved_queue_count <> cardinality(queue_ids)
      or reserved_draft_count <> 1
    then
      raise exception 'review_queue_reserved_by_another_draft'
        using errcode = '40001';
    end if;

    select draft.id
    into active_draft_id
    from public.student_vocab_review_assignment_drafts as draft
    where draft.id = reserved_draft_id
      and draft.student_id = p_student_id
      and draft.dataset_id = selected_dataset_id
      and draft.status = 'pending'
      and draft.expires_at > clock_timestamp()
    for update;

    if active_draft_id is null then
      raise exception 'review_queue_reservation_inconsistent'
        using errcode = '40001';
    end if;

    select count(*)
    into active_draft_item_count
    from public.student_vocab_review_assignment_draft_items as item
    where item.draft_id = active_draft_id
      and item.queue_id = any(queue_ids);

    if active_draft_item_count = cardinality(queue_ids)
      and active_draft_item_count = (
        select count(*)
        from public.student_vocab_review_assignment_draft_items as item
        where item.draft_id = active_draft_id
      )
    then
      return active_draft_id;
    end if;

    raise exception 'review_queue_reserved_by_another_draft'
      using errcode = '40001';
  end if;

  insert into public.student_vocab_review_assignment_drafts (
    student_id,
    dataset_id,
    created_by
  )
  values (
    p_student_id,
    selected_dataset_id,
    (select auth.uid())
  )
  returning id into created_draft_id;

  update public.student_vocab_review_queue as queue
  set
    reserved_review_draft_id = created_draft_id,
    reserved_at = clock_timestamp()
  where queue.id = any(queue_ids)
    and queue.student_id = p_student_id
    and queue.dataset_id = selected_dataset_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id is null;

  get diagnostics updated_queue_count = row_count;
  if updated_queue_count <> cardinality(queue_ids) then
    raise exception 'review_draft_queue_reservation_race'
      using errcode = '40001';
  end if;

  insert into public.student_vocab_review_assignment_draft_items (
    draft_id,
    queue_id,
    position
  )
  select
    created_draft_id,
    selected.queue_id,
    selected.position::integer
  from unnest(queue_ids) with ordinality
    as selected(queue_id, position);

  if (
    select count(*)
    from public.student_vocab_review_assignment_draft_items as item
    where item.draft_id = created_draft_id
  ) <> cardinality(queue_ids) then
    raise exception 'review_draft_item_insert_mismatch'
      using errcode = '21000';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'student.review_assignment_draft.created',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'draftId', created_draft_id,
      'datasetId', selected_dataset_id,
      'questionCount', cardinality(p_question_ids),
      'queueCount', cardinality(queue_ids),
      'queueIds', to_jsonb(queue_ids)
    )
  );

  return created_draft_id;
end;
$$;

create function public.create_student_vocab_review_assignment_draft(
  p_student_id uuid,
  p_question_ids uuid[]
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_student_vocab_review_assignment_draft(
    p_student_id,
    p_question_ids
  );
$$;

revoke all on function
  private.create_student_vocab_review_assignment_draft(uuid, uuid[])
  from public, anon, authenticated;
revoke all on function
  public.create_student_vocab_review_assignment_draft(uuid, uuid[])
  from public, anon;

grant execute on function
  private.create_student_vocab_review_assignment_draft(uuid, uuid[])
  to authenticated, service_role;
grant execute on function
  public.create_student_vocab_review_assignment_draft(uuid, uuid[])
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
