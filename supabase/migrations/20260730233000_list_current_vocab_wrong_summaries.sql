begin;

create function public.list_student_current_vocab_wrong_summaries(
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
  identities as materialized (
    select
      wrong_event.student_id,
      wrong_event.dataset_id,
      case
        when wrong_event.canonical_lexeme_id_snapshot is not null
          then
            'canonical:'
            || wrong_event.canonical_lexeme_id_snapshot::text
        else
          'entry:'
          || wrong_event.dataset_id::text
          || ':'
          || wrong_event.vocab_entry_id::text
      end as word_key
    from public.student_vocab_wrong_events as wrong_event
    join page_students as student
      on student.id = wrong_event.student_id
  ),
  word_totals as (
    select
      identity.student_id,
      identity.word_key,
      count(*)::integer as wrong_count
    from identities as identity
    group by identity.student_id, identity.word_key
  ),
  current_words as (
    select distinct
      identity.student_id,
      identity.word_key
    from identities as identity
    join page_students as student
      on student.id = identity.student_id
    where identity.dataset_id = student.dataset_id
  )
  select
    student.id as student_id,
    student.dataset_id,
    count(current_word.word_key)::integer as wrong_word_count,
    count(current_word.word_key) filter (
      where word_total.wrong_count >= 2
    )::integer as repeated_wrong_word_count
  from page_students as student
  left join current_words as current_word
    on current_word.student_id = student.id
  left join word_totals as word_total
    on word_total.student_id = current_word.student_id
    and word_total.word_key = current_word.word_key
  group by student.id, student.dataset_id
  order by student.id;
end;
$$;

revoke all on function
  public.list_student_current_vocab_wrong_summaries(uuid, integer)
  from public, anon, authenticated;
grant execute on function
  public.list_student_current_vocab_wrong_summaries(uuid, integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
