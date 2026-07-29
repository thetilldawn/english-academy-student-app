begin;

create function public.list_student_vocab_review_queue_summaries(
  p_after_student_id uuid default null,
  p_after_dataset_id uuid default null,
  p_limit integer default 500
)
returns table (
  student_id uuid,
  dataset_id uuid,
  pending_level_1_count integer,
  pending_level_2_count integer,
  reserved_level_1_count integer,
  reserved_level_2_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit is null
    or p_limit not between 1 and 500
    or (
      (p_after_student_id is null)
      <> (p_after_dataset_id is null)
    )
  then
    raise exception 'invalid_review_queue_summary_cursor'
      using errcode = '22023';
  end if;

  return query
  select
    queue.student_id,
    queue.dataset_id,
    count(*) filter (
      where queue.reason_level = 1
    )::integer as pending_level_1_count,
    count(*) filter (
      where queue.reason_level = 2
    )::integer as pending_level_2_count,
    count(*) filter (
      where queue.reason_level = 1
        and queue.reserved_review_draft_id is not null
    )::integer as reserved_level_1_count,
    count(*) filter (
      where queue.reason_level = 2
        and queue.reserved_review_draft_id is not null
    )::integer as reserved_level_2_count
  from public.student_vocab_review_queue as queue
  where queue.status = 'pending'
    and (
      p_after_student_id is null
      or (queue.student_id, queue.dataset_id)
        > (p_after_student_id, p_after_dataset_id)
    )
  group by queue.student_id, queue.dataset_id
  order by queue.student_id, queue.dataset_id
  limit p_limit;
end;
$$;

revoke all on function
  public.list_student_vocab_review_queue_summaries(
    uuid,
    uuid,
    integer
  )
  from public, anon, authenticated;
grant execute on function
  public.list_student_vocab_review_queue_summaries(
    uuid,
    uuid,
    integer
  )
  to authenticated;

notify pgrst, 'reload schema';

commit;
