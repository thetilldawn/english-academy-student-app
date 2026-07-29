begin;

create function public.finalize_expired_review_assignment_drafts(
  p_student_id uuid,
  p_limit integer default 400
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_draft_ids uuid[];
  expired_draft_ids uuid[];
  finalized_count integer;
begin
  if p_student_id is null
    or p_limit is null
    or p_limit not between 1 and 1000
  then
    raise exception 'invalid_review_draft_finalize_input'
      using errcode = '22023';
  end if;

  -- Every supported producer and consumer locks the student first. Keeping
  -- the same order serializes cleanup with draft creation and consumption.
  perform 1
  from public.students as student
  where student.id = p_student_id
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
    array_agg(candidate.id order by candidate.expires_at, candidate.id),
    array[]::uuid[]
  )
  into candidate_draft_ids
  from (
    select draft.id, draft.expires_at
    from public.student_vocab_review_assignment_drafts as draft
    where draft.student_id = p_student_id
      and draft.status = 'pending'
      and draft.expires_at <= clock_timestamp()
    order by draft.expires_at, draft.id
    limit p_limit
  ) as candidate;

  if cardinality(candidate_draft_ids) = 0 then
    return 0;
  end if;

  perform queue.id
  from public.student_vocab_review_queue as queue
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = any(candidate_draft_ids)
  order by queue.id
  for update;

  perform draft.id
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = any(candidate_draft_ids)
  order by draft.id
  for update;

  with expired as (
    update public.student_vocab_review_assignment_drafts as draft
    set
      status = 'expired',
      expired_at = clock_timestamp()
    where draft.id = any(candidate_draft_ids)
      and draft.student_id = p_student_id
      and draft.status = 'pending'
      and draft.expires_at <= clock_timestamp()
    returning draft.id
  )
  select coalesce(array_agg(expired.id order by expired.id), array[]::uuid[])
  into expired_draft_ids
  from expired;

  finalized_count := cardinality(expired_draft_ids);
  if finalized_count = 0 then
    return 0;
  end if;

  update public.student_vocab_review_queue as queue
  set
    reserved_review_draft_id = null,
    reserved_at = null
  where queue.student_id = p_student_id
    and queue.status = 'pending'
    and queue.reserved_review_draft_id = any(expired_draft_ids);

  insert into public.audit_events (
    event_type,
    student_id,
    details
  )
  values (
    'student.review_assignment_drafts.expired',
    p_student_id,
    jsonb_build_object(
      'draftCount', finalized_count,
      'draftIds', to_jsonb(expired_draft_ids)
    )
  );

  return finalized_count;
end;
$$;

revoke all on function
  public.finalize_expired_review_assignment_drafts(uuid, integer)
  from public, anon, authenticated;
grant execute on function
  public.finalize_expired_review_assignment_drafts(uuid, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
