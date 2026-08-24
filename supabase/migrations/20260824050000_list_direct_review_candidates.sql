begin;

-- Independent review assignments use current unresolved wrong words. The
-- manual review queue remains a separate teacher-selected workflow.
create index if not exists student_vocab_state_direct_review_idx
  on public.student_vocab_state (
    student_id,
    last_wrong_at desc,
    vocab_entry_id,
    last_attempt_id
  )
  where unresolved_wrong_count > 0 and resolved_at is null;

create index if not exists student_vocab_wrong_events_direct_review_idx
  on public.student_vocab_wrong_events (
    student_id,
    dataset_id,
    wrong_stage,
    canonical_dictionary_id_snapshot,
    canonical_lexeme_id_snapshot,
    vocab_entry_id,
    quiz_attempt_id
  );

create function private.list_student_direct_review_candidates_v1(
  p_student_id uuid,
  p_dataset_id uuid default null
)
returns table (
  source_question_id uuid,
  dataset_id uuid,
  vocab_entry_id bigint,
  canonical_dictionary_id text,
  canonical_lexeme_id uuid,
  headword_normalized text,
  reason_level smallint,
  wrong_count integer,
  last_wrong_at timestamptz,
  existing_queue_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with unresolved_base as materialized (
    select
      state.student_id,
      entry.dataset_id,
      state.vocab_entry_id,
      state.last_attempt_id,
      state.last_wrong_at,
      coalesce(
        state.canonical_dictionary_id_snapshot,
        wrong_event.canonical_dictionary_id_snapshot
      ) as dictionary_id,
      coalesce(
        wrong_event.canonical_lexeme_id_snapshot,
        entry_identity.canonical_lexeme_id
      ) as canonical_lexeme_id,
      entry.headword_normalized,
      question.id as source_question_id
    from public.student_vocab_state as state
    join public.vocab_entries as entry
      on entry.id = state.vocab_entry_id
    join public.vocab_datasets as dataset
      on dataset.id = entry.dataset_id
     and dataset.status = 'ready'
     and dataset.is_active
    join public.quiz_questions as question
      on question.attempt_id = state.last_attempt_id
     and question.vocab_entry_id = state.vocab_entry_id
     and question.initial_is_correct is false
     and question.retry_is_correct is distinct from true
    join public.quiz_attempts as attempt
      on attempt.id = question.attempt_id
     and attempt.student_id = state.student_id
     and (
       attempt.status in ('completed', 'expired')
       or (
         attempt.status = 'in_progress'
         and attempt.phase in ('review', 'retry')
       )
     )
    left join public.student_vocab_wrong_events as wrong_event
      on wrong_event.quiz_question_id = question.id
     and wrong_event.quiz_attempt_id = question.attempt_id
     and wrong_event.student_id = state.student_id
     and wrong_event.wrong_stage = 'initial'
    left join lateral (
      select min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = entry.id
        and eligibility.dataset_id = entry.dataset_id
        and eligibility.status = 'eligible'
    ) as entry_identity on true
    where state.student_id = p_student_id
      and state.unresolved_wrong_count > 0
      and state.resolved_at is null
      and (p_dataset_id is null or entry.dataset_id = p_dataset_id)
      and exists (
        select 1
        from public.student_vocab_wrong_events as recorded_wrong
        where recorded_wrong.student_id = state.student_id
          and recorded_wrong.quiz_question_id = question.id
          and recorded_wrong.wrong_stage = 'initial'
      )
      and (
        exists (
          select 1
          from word_index.app_exam_use_release as release
          join word_index.app_exam_use_occurrence as occurrence
            on occurrence.release_id = release.release_id
           and occurrence.dataset_id = entry.dataset_id
           and occurrence.vocab_entry_id = entry.id
           and occurrence.include_in_exam
           and occurrence.exam_use_status = 'reviewed_for_preview'
          where release.dataset_id = entry.dataset_id
            and release.status = 'active'
        )
        or (
          not exists (
            select 1
            from word_index.app_exam_use_release as release
            where release.dataset_id = entry.dataset_id
          )
          and exists (
            select 1
            from public.vocab_entry_quiz_eligibility as eligibility
            where eligibility.vocab_entry_id = entry.id
              and eligibility.dataset_id = entry.dataset_id
              and eligibility.status = 'eligible'
          )
        )
      )
  ),
  dictionary_by_canonical as materialized (
    select
      candidate.dataset_id,
      candidate.canonical_lexeme_id,
      min(candidate.dictionary_id) as dictionary_id
    from unresolved_base as candidate
    where candidate.dictionary_id is not null
      and candidate.canonical_lexeme_id is not null
    group by candidate.dataset_id, candidate.canonical_lexeme_id
  ),
  unresolved_rows as materialized (
    select
      unresolved.*,
      coalesce(
        unresolved.dictionary_id,
        dictionary_by_canonical.dictionary_id
      ) as resolved_dictionary_id,
      case
        when coalesce(
          unresolved.dictionary_id,
          dictionary_by_canonical.dictionary_id
        ) is not null
          then 'dictionary:' || coalesce(
            unresolved.dictionary_id,
            dictionary_by_canonical.dictionary_id
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
    left join dictionary_by_canonical
      on unresolved.dictionary_id is null
     and dictionary_by_canonical.dataset_id = unresolved.dataset_id
     and dictionary_by_canonical.canonical_lexeme_id =
       unresolved.canonical_lexeme_id
  ),
  ranked_words as materialized (
    select
      unresolved.*,
      row_number() over (
        partition by unresolved.dataset_id, unresolved.word_key
        order by
          unresolved.last_wrong_at desc nulls last,
          unresolved.vocab_entry_id,
          unresolved.source_question_id
      ) as word_rank
    from unresolved_rows as unresolved
  ),
  current_words as materialized (
    select
      student_id,
      dataset_id,
      vocab_entry_id,
      last_wrong_at,
      canonical_lexeme_id,
      headword_normalized,
      source_question_id,
      resolved_dictionary_id,
      word_key
    from ranked_words
    where word_rank = 1
  ),
  wrong_history as materialized (
    select
      wrong_event.student_id,
      wrong_event.dataset_id,
      wrong_event.vocab_entry_id,
      wrong_event.canonical_dictionary_id_snapshot,
      wrong_event.canonical_lexeme_id_snapshot,
      wrong_event.quiz_attempt_id,
      wrong_entry.headword_normalized
    from public.student_vocab_wrong_events as wrong_event
    join public.vocab_entries as wrong_entry
      on wrong_entry.id = wrong_event.vocab_entry_id
     and wrong_entry.dataset_id = wrong_event.dataset_id
    where wrong_event.student_id = p_student_id
      and wrong_event.wrong_stage = 'initial'
      and (
        p_dataset_id is null
        or wrong_event.dataset_id = p_dataset_id
      )
  ),
  counted_words as materialized (
    select
      current_word.*,
      count(distinct wrong_history.quiz_attempt_id)::integer as wrong_count
    from current_words as current_word
    left join wrong_history
      on private.vocab_identity_matches_v1(
        current_word.dataset_id,
        current_word.vocab_entry_id,
        current_word.resolved_dictionary_id,
        current_word.canonical_lexeme_id,
        current_word.headword_normalized,
        wrong_history.dataset_id,
        wrong_history.vocab_entry_id,
        wrong_history.canonical_dictionary_id_snapshot,
        wrong_history.canonical_lexeme_id_snapshot,
        wrong_history.headword_normalized
      )
    group by
      current_word.student_id,
      current_word.dataset_id,
      current_word.vocab_entry_id,
      current_word.last_wrong_at,
      current_word.canonical_lexeme_id,
      current_word.headword_normalized,
      current_word.source_question_id,
      current_word.resolved_dictionary_id,
      current_word.word_key
  ),
  available_words as materialized (
    select counted.*
    from counted_words as counted
    where counted.wrong_count > 0
      and not exists (
        select 1
        from public.student_vocab_review_queue as reserved_queue
        join public.vocab_entries as reserved_entry
          on reserved_entry.id = reserved_queue.vocab_entry_id
         and reserved_entry.dataset_id = reserved_queue.dataset_id
        where reserved_queue.student_id = counted.student_id
          and reserved_queue.dataset_id = counted.dataset_id
          and reserved_queue.status = 'pending'
          and reserved_queue.reserved_review_draft_id is not null
          and private.vocab_identity_matches_v1(
            counted.dataset_id,
            counted.vocab_entry_id,
            counted.resolved_dictionary_id,
            counted.canonical_lexeme_id,
            counted.headword_normalized,
            reserved_queue.dataset_id,
            reserved_queue.vocab_entry_id,
            reserved_queue.canonical_dictionary_id_snapshot,
            reserved_queue.canonical_lexeme_id_snapshot,
            reserved_entry.headword_normalized
          )
      )
      and not exists (
        select 1
        from public.assignment_students as link
        join public.assignments as assignment
          on assignment.id = link.assignment_id
         and assignment.dataset_id = counted.dataset_id
         and assignment.status <> 'closed'
        join public.assignment_questions as active_question
          on active_question.assignment_id = assignment.id
        join public.vocab_entries as active_entry
          on active_entry.id = active_question.vocab_entry_id
         and active_entry.dataset_id = assignment.dataset_id
        left join public.assignment_question_exam_use_snapshot
          as active_snapshot
          on active_snapshot.assignment_question_id = active_question.id
        left join lateral (
          select min(eligibility.canonical_lexeme_id::text)::uuid
            as canonical_lexeme_id
          from public.vocab_entry_quiz_eligibility as eligibility
          where eligibility.vocab_entry_id = active_question.vocab_entry_id
            and eligibility.dataset_id = assignment.dataset_id
            and eligibility.status = 'eligible'
        ) as active_identity on true
        where link.student_id = counted.student_id
          and link.cancelled_at is null
          and link.missed_at is null
          and (
            not exists (
              select 1
              from public.quiz_attempts as active_attempt
              where active_attempt.assignment_id = link.assignment_id
                and active_attempt.student_id = link.student_id
            )
            or exists (
              select 1
              from public.quiz_attempts as active_attempt
              where active_attempt.assignment_id = link.assignment_id
                and active_attempt.student_id = link.student_id
                and active_attempt.status = 'in_progress'
            )
          )
          and private.vocab_identity_matches_v1(
            counted.dataset_id,
            counted.vocab_entry_id,
            counted.resolved_dictionary_id,
            counted.canonical_lexeme_id,
            counted.headword_normalized,
            assignment.dataset_id,
            active_question.vocab_entry_id,
            active_snapshot.dictionary_id,
            coalesce(
              active_question.canonical_lexeme_id_snapshot,
              active_identity.canonical_lexeme_id
            ),
            coalesce(
              active_question.headword_normalized_snapshot,
              active_entry.headword_normalized
            )
          )
      )
  )
  select
    available.source_question_id,
    available.dataset_id,
    available.vocab_entry_id,
    available.resolved_dictionary_id,
    available.canonical_lexeme_id,
    available.headword_normalized,
    least(available.wrong_count, 2)::smallint,
    available.wrong_count,
    available.last_wrong_at,
    existing_queue.id
  from available_words as available
  left join lateral (
    select queue.id
    from public.student_vocab_review_queue as queue
    join public.vocab_entries as queue_entry
      on queue_entry.id = queue.vocab_entry_id
     and queue_entry.dataset_id = queue.dataset_id
    where queue.student_id = available.student_id
      and queue.dataset_id = available.dataset_id
      and queue.status = 'pending'
      and queue.reserved_review_draft_id is null
      and private.vocab_identity_matches_v1(
        available.dataset_id,
        available.vocab_entry_id,
        available.resolved_dictionary_id,
        available.canonical_lexeme_id,
        available.headword_normalized,
        queue.dataset_id,
        queue.vocab_entry_id,
        queue.canonical_dictionary_id_snapshot,
        queue.canonical_lexeme_id_snapshot,
        queue_entry.headword_normalized
      )
    order by queue.reason_level desc, queue.queued_at, queue.id
    limit 1
  ) as existing_queue on true;
$$;

revoke all on function private.list_student_direct_review_candidates_v1(
  uuid, uuid
) from public, anon, authenticated, service_role;

create function public.list_student_direct_review_dataset_summaries_v1(
  p_student_id uuid
)
returns table (
  dataset_id uuid,
  level_1_count integer,
  level_2_count integer,
  total_count integer,
  latest_wrong_at timestamptz
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
  if p_student_id is null or not exists (
    select 1
    from public.students as student
    where student.id = p_student_id
      and student.status = 'active'
      and student.deleted_at is null
  ) then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  return query
  select
    candidate.dataset_id,
    count(*) filter (where candidate.reason_level = 1)::integer,
    count(*) filter (where candidate.reason_level = 2)::integer,
    count(*)::integer,
    max(candidate.last_wrong_at)
  from private.list_student_direct_review_candidates_v1(
    p_student_id,
    null
  ) as candidate
  group by candidate.dataset_id
  order by max(candidate.last_wrong_at) desc nulls last, candidate.dataset_id;
end;
$$;

create function public.list_student_direct_review_candidates_v1(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_limit integer default 400
)
returns table (
  source_question_id uuid,
  dataset_id uuid,
  vocab_entry_id bigint,
  canonical_dictionary_id text,
  canonical_lexeme_id uuid,
  headword_normalized text,
  reason_level smallint,
  wrong_count integer,
  last_wrong_at timestamptz,
  existing_queue_id uuid
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
  if p_student_id is null
    or p_dataset_id is null
    or p_review_levels is null
    or cardinality(p_review_levels) not between 1 and 2
    or cardinality(p_review_levels) <> (
      select count(distinct level)
      from unnest(p_review_levels) as input(level)
      where level in (1, 2)
    )
    or p_limit is null
    or p_limit not between 1 and 400
  then
    raise exception 'invalid_direct_review_candidate_query'
      using errcode = '22023';
  end if;

  return query
  select candidate.*
  from private.list_student_direct_review_candidates_v1(
    p_student_id,
    p_dataset_id
  ) as candidate
  where candidate.reason_level = any(p_review_levels)
  order by
    candidate.reason_level desc,
    candidate.last_wrong_at desc nulls last,
    candidate.source_question_id
  limit p_limit;
end;
$$;

revoke all on function public.list_student_direct_review_dataset_summaries_v1(
  uuid
) from public, anon;
revoke all on function public.list_student_direct_review_candidates_v1(
  uuid, uuid, smallint[], integer
) from public, anon;
grant execute on function
  public.list_student_direct_review_dataset_summaries_v1(uuid)
  to authenticated;
grant execute on function
  public.list_student_direct_review_candidates_v1(
    uuid, uuid, smallint[], integer
  ) to authenticated;

notify pgrst, 'reload schema';

commit;
