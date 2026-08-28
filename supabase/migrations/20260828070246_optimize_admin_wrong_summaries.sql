begin;

-- Keep the definition of an active reservation in one read-only database
-- boundary. Expired or otherwise inactive drafts remain available to the
-- maintenance job for physical cleanup, but are no longer exposed as active.
create view public.student_vocab_review_queue_read_v1
with (security_invoker = true)
as
select
  queue.id,
  queue.student_id,
  queue.dataset_id,
  queue.vocab_entry_id,
  queue.canonical_dictionary_id_snapshot,
  queue.canonical_lexeme_id_snapshot,
  queue.source_question_id,
  queue.reason_level,
  queue.queued_at,
  queue.status,
  case
    when draft.id is not null then draft.id
    else null
  end as active_review_draft_id
from public.student_vocab_review_queue as queue
left join public.student_vocab_review_assignment_drafts as draft
  on draft.id = queue.reserved_review_draft_id
 and draft.student_id = queue.student_id
 and draft.dataset_id = queue.dataset_id
 and draft.status = 'pending'
 and draft.expires_at > transaction_timestamp();

revoke all on table public.student_vocab_review_queue_read_v1
  from public, anon, authenticated, service_role;
grant select on table public.student_vocab_review_queue_read_v1
  to authenticated, service_role;

create or replace function
  public.list_student_vocab_review_queue_summaries(
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
        and queue.active_review_draft_id is not null
    )::integer as reserved_level_1_count,
    count(*) filter (
      where queue.reason_level = 2
        and queue.active_review_draft_id is not null
    )::integer as reserved_level_2_count
  from public.student_vocab_review_queue_read_v1 as queue
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
  from public, anon, authenticated, service_role;
grant execute on function
  public.list_student_vocab_review_queue_summaries(
    uuid,
    uuid,
    integer
  )
  to authenticated, service_role;

-- Count current-book wrong words with one set-based pass. The previous
-- implementation re-read the same wrong-event history once per unresolved
-- word and exceeded the authenticated statement timeout on Preview data.
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
      select
        min(eligibility.canonical_lexeme_id::text)::uuid
          as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = entry.id
        and eligibility.dataset_id = entry.dataset_id
        and eligibility.status = 'eligible'
    ) as entry_identity on true
  ),
  canonical_dictionary_bridge as materialized (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.canonical_lexeme_id,
      min(unresolved.dictionary_id) as dictionary_id
    from unresolved_base as unresolved
    where unresolved.dictionary_id is not null
      and unresolved.canonical_lexeme_id is not null
    group by
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.canonical_lexeme_id
  ),
  unresolved_rows as materialized (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.vocab_entry_id,
      coalesce(
        unresolved.dictionary_id,
        bridge.dictionary_id
      ) as dictionary_id,
      unresolved.canonical_lexeme_id,
      unresolved.headword_normalized,
      case
        when coalesce(
          unresolved.dictionary_id,
          bridge.dictionary_id
        ) is not null
          then 'dictionary:' || coalesce(
            unresolved.dictionary_id,
            bridge.dictionary_id
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
    left join canonical_dictionary_bridge as bridge
      on unresolved.dictionary_id is null
     and bridge.student_id = unresolved.student_id
     and bridge.dataset_id = unresolved.dataset_id
     and bridge.canonical_lexeme_id =
       unresolved.canonical_lexeme_id
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
  initial_wrong_events as materialized (
    select
      wrong_event.student_id,
      wrong_event.dataset_id,
      wrong_event.vocab_entry_id,
      wrong_event.quiz_attempt_id,
      wrong_event.canonical_dictionary_id_snapshot
        as dictionary_id,
      wrong_event.canonical_lexeme_id_snapshot
        as canonical_lexeme_id,
      wrong_entry.headword_normalized
    from public.student_vocab_wrong_events as wrong_event
    join page_students as student
      on student.id = wrong_event.student_id
     and student.dataset_id = wrong_event.dataset_id
    join public.vocab_entries as wrong_entry
      on wrong_entry.id = wrong_event.vocab_entry_id
     and wrong_entry.dataset_id = wrong_event.dataset_id
    where wrong_event.wrong_stage = 'initial'
  ),
  word_counts as (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key,
      count(distinct wrong_event.quiz_attempt_id)::integer
        as wrong_count
    from unresolved_words as unresolved
    left join initial_wrong_events as wrong_event
      on wrong_event.student_id = unresolved.student_id
     and wrong_event.dataset_id = unresolved.dataset_id
     and private.vocab_identity_matches_v1(
       unresolved.dataset_id,
       unresolved.vocab_entry_id,
       unresolved.dictionary_id,
       unresolved.canonical_lexeme_id,
       unresolved.headword_normalized,
       wrong_event.dataset_id,
       wrong_event.vocab_entry_id,
       wrong_event.dictionary_id,
       wrong_event.canonical_lexeme_id,
       wrong_event.headword_normalized
     )
    group by
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key
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

revoke all on function
  public.list_student_current_vocab_wrong_summaries(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.list_student_current_vocab_wrong_summaries(uuid, integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
